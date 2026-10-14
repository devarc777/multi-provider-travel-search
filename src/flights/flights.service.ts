import {
  Injectable,
  HttpException,
  HttpStatus,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Amadeus from 'amadeus';

interface FlightSearchJob {
  searchId: string;
  status: 'processing' | 'complete' | 'error';
  results?: any[];
  error?: string;
  createdAt: Date;
  expiresAt: Date;
}

const KIWI_FLIGHTS_IMAGE =
  'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&h=300&fit=crop';

@Injectable()
export class FlightsService implements OnModuleDestroy {
  private amadeus: Amadeus | null = null;
  private rapidApiKey: string;
  private rapidApiHost: string;
  // Booking.com RapidAPI host (booking-com15)
  private bookingApiHost = 'booking-com15.p.rapidapi.com';
  private searchJobs = new Map<string, FlightSearchJob>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(private configService: ConfigService) {
    // Kiwi / realtime RapidAPI is primary for search
    this.rapidApiKey =
      this.configService.get<string>('RAPIDAPI_KEY') || '';
    this.rapidApiHost =
      this.configService.get<string>('RAPIDAPI_HOST_KIWI_FLIGHTS') ||
      'flights-real-time-data.p.rapidapi.com';

    if (this.rapidApiKey) {
      console.log('✅ Flight search: Flights Real-Time Data (RapidAPI)');
      console.log(
        '✅ Flight search: Booking.com (booking-com15) RapidAPI key configured',
      );
    } else {
      console.warn('⚠️ RAPIDAPI_KEY missing; set it in .env for flight search.');
    }

    // Amadeus as fallback when RapidAPI fails (booking still redirects to Kiwi)
    const apiKey = this.configService.get<string>('AMADEUS_API_KEY');
    const apiSecret = this.configService.get<string>('AMADEUS_API_SECRET');
    if (apiKey && apiSecret) {
      try {
        this.amadeus = new Amadeus({
          clientId: apiKey,
          clientSecret: apiSecret,
          hostname: 'test',
        });
        if (this.amadeus?.shopping?.flightOffersSearch) {
          console.log('✅ Amadeus fallback available for flight search');
        }
      } catch (e: any) {
        console.warn('⚠️ Amadeus init failed:', e?.message);
        this.amadeus = null;
      }
    }

    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredJobs(),
      5 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      console.log('✅ FlightsService: Cleaned up interval');
    }
  }

  private generateSearchId(): string {
    return `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // drop jobs older than their expiresAt
  private cleanupExpiredJobs() {
    const now = new Date();
    for (const [searchId, job] of this.searchJobs.entries()) {
      if (job.expiresAt < now) {
        this.searchJobs.delete(searchId);
        console.log(`🗑️ Cleaned up expired search job: ${searchId}`);
      }
    }
  }

  // kick off async search, return id immediately
  async startFlightSearch(params: {
    originLocationCode: string;
    destinationLocationCode: string;
    departureDate: string;
    adults?: number;
    returnDate?: string;
  }): Promise<string> {
    const searchId = this.generateSearchId();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    this.searchJobs.set(searchId, {
      searchId,
      status: 'processing',
      createdAt: new Date(),
      expiresAt,
    });

    // don't await — client polls /results
    this.processFlightSearch(searchId, params).catch((error) => {
      console.error(`❌ Search job ${searchId} failed:`, error);
      const job = this.searchJobs.get(searchId);
      if (job) {
        job.status = 'error';
        job.error = error.message || 'Failed to search flights';
      }
    });

    return searchId;
  }

  private async processFlightSearch(
    searchId: string,
    params: {
      originLocationCode: string;
      destinationLocationCode: string;
      departureDate: string;
      adults?: number;
      returnDate?: string;
    },
  ) {
    try {
      console.log(
        `🔄 Processing search ${searchId} for ${params.originLocationCode} → ${params.destinationLocationCode} on ${params.departureDate}`,
      );

      const flights = await this.searchFlights(params);

      if (flights.length > 0) {
        console.log('📋 First flight structure check:', {
          hasAmadeusData: !!flights[0].amadeusData,
          amadeusDataKeys: flights[0].amadeusData
            ? Object.keys(flights[0].amadeusData).slice(0, 10)
            : [],
          hasId: !!flights[0].amadeusData?.id,
          hasSource: !!flights[0].amadeusData?.source,
        });
      }

      const job = this.searchJobs.get(searchId);
      if (job) {
        job.status = 'complete';
        job.results = flights;
        console.log(
          `✅ Search ${searchId} completed with ${flights.length} flights`,
        );
      } else {
        console.error(`❌ Search job ${searchId} not found in jobs map`);
      }
    } catch (error: any) {
      console.error(`❌ Search ${searchId} error:`, error);
      console.error(`❌ Error details:`, {
        message: error.message,
        stack: error.stack,
        code: error.code,
      });
      const job = this.searchJobs.get(searchId);
      if (job) {
        job.status = 'error';
        job.error = error.message || 'Failed to search flights';
        console.log(`❌ Search ${searchId} marked as error: ${job.error}`);
      } else {
        console.error(
          `❌ Search job ${searchId} not found when trying to mark as error`,
        );
      }
    }
  }

  getSearchStatus(searchId: string): FlightSearchJob | null {
    const job = this.searchJobs.get(searchId);
    if (!job) return null;
    return job;
  }

  async searchFlights(params: {
    originLocationCode: string;
    destinationLocationCode: string;
    departureDate: string;
    adults?: number;
    returnDate?: string;
  }) {
    const origin = params.originLocationCode.toUpperCase();
    const destination = params.destinationLocationCode.toUpperCase();
    const adults = params.adults || 1;

    if (!this.rapidApiKey) {
      throw new HttpException(
        'Flight search not configured. Set RAPIDAPI_KEY in .env for Kiwi search.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      // Booking.com first, then Kiwi / realtime API
      try {
        const bookingResults = await this.searchFlightsViaBookingCom({
          origin,
          destination,
          departureDate: params.departureDate,
          adults,
        });
        if (bookingResults.length > 0) {
          return bookingResults;
        }
      } catch (bookingError: any) {
        console.error(
          '❌ Booking.com RapidAPI Error (searchFlights), falling back to Kiwi:',
          bookingError?.message || bookingError,
        );
      }

      const kiwiResults = await this.searchFlightsKiwi({
        origin,
        destination,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        adults,
      });
      return kiwiResults;
    } catch (e: any) {
      if (e?.message === 'KIWI_API_UNAVAILABLE') return [];
      throw e;
    }
  }

  // RapidAPI flights — /deals/search or legacy /one-way
  private async searchFlightsKiwi(params: {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate?: string;
    adults: number;
  }): Promise<any[]> {
    const base = `https://${this.rapidApiHost}`;
    const isRealtimeApi = this.rapidApiHost.includes('flights-real-time-data');
    const url = new URL(isRealtimeApi ? `${base}/deals/search` : `${base}/one-way`);

    if (isRealtimeApi) {
      url.searchParams.set('query', params.origin);
      if (params.destination) url.searchParams.set('to', params.destination);
      if (params.departureDate) url.searchParams.set('date', params.departureDate);
    } else {
      url.searchParams.set('source', params.origin);
      url.searchParams.set('destination', params.destination);
      url.searchParams.set('currency', 'usd');
      url.searchParams.set('locale', 'en');
      url.searchParams.set('adults', String(params.adults));
      url.searchParams.set('limit', '50');
      url.searchParams.set('outbound', params.departureDate);
      if (params.returnDate) url.searchParams.set('inbound', params.returnDate);
    }

    console.log('🔍 Searching flights:', params.origin, '→', params.destination, 'URL:', url.toString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': this.rapidApiHost,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const rawText = await res.text();
      if (!res.ok) {
        console.error('❌ Flight API error:', res.status, rawText?.slice(0, 400));
        return [];
      }

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        console.error('❌ Flight API invalid JSON:', rawText?.slice(0, 200));
        return [];
      }

      if (data && typeof data === 'object' && data.error === 'Value is not JSON serializable') {
        throw new Error('KIWI_API_UNAVAILABLE');
      }

      let list = this.extractKiwiFlightList(data);
      if (!isRealtimeApi && list.length === 0) {
        list = await this.searchFlightsKiwiFallback(params);
      }
      if (list.length > 0) {
        console.log(`✅ Flight API: ${list.length} results for ${params.origin} → ${params.destination}`);
      } else if (list.length === 0 && data && typeof data === 'object') {
        const keys = Object.keys(data).join(', ');
        console.warn('⚠️ Flight API returned 0 results. Response keys:', keys, 'Sample:', JSON.stringify(data).slice(0, 300));
      }

      return this.transformKiwiResponse(list, {
        origin: params.origin,
        destination: params.destination,
        departureDate: params.departureDate,
        adults: params.adults,
      });
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') return [];
      if (e?.message === 'KIWI_API_UNAVAILABLE') return [];
      throw e;
    }
  }

  // Booking.com flights search (booking-com15)
  private async searchFlightsViaBookingCom(params: {
    origin: string;
    destination: string;
    departureDate: string;
    adults: number;
  }): Promise<any[]> {
    if (!this.rapidApiKey) {
      throw new HttpException(
        'Booking.com flight search is not configured (missing RAPIDAPI_KEY).',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Booking.com expects CODE.AIRPORT ids
    const fromId = `${params.origin}.AIRPORT`;
    const toId = `${params.destination}.AIRPORT`;

    const url = new URL(
      `https://${this.bookingApiHost}/api/v1/flights/searchFlights`,
    );
    url.searchParams.set('fromId', fromId);
    url.searchParams.set('toId', toId);
    url.searchParams.set('departDate', params.departureDate);
    url.searchParams.set('stops', 'none'); // nonstop default
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('adults', String(params.adults));
    url.searchParams.set('sort', 'BEST');
    url.searchParams.set('cabinClass', 'ECONOMY');
    url.searchParams.set('currency_code', 'AED');

    console.log(
      '✈️ Calling Booking.com (booking-com15) flights search with URL:',
      url.toString(),
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let res: Response;
    try {
      // eslint-disable-next-line no-undef
      res = (await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': this.bookingApiHost,
        },
        signal: controller.signal as any,
      })) as any;
    } catch (error: any) {
      clearTimeout(timeout);
      if (error?.name === 'AbortError') {
        console.error(
          '❌ Booking.com flights search timed out for',
          params.origin,
          '→',
          params.destination,
        );
      } else {
        console.error(
          '❌ Booking.com flights search failed:',
          error?.message || error,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await res.text();

    if (!res.ok) {
      let body: any = null;
      try {
        body = JSON.parse(rawText);
      } catch {
        body = null;
      }
      console.error('❌ Booking.com flights search error:', {
        status: res.status,
        body: body || rawText?.slice(0, 400),
      });

      throw new HttpException(
        (body && (body.detail || body.message)) ||
          rawText ||
          'Booking.com flights search failed',
        res.status as any,
      );
    }

    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error(
        '❌ Booking.com flights response was not valid JSON:',
        rawText?.slice(0, 400),
      );
      return [];
    }

    const flightOffers: any[] = data?.data?.flightOffers || [];
    if (!Array.isArray(flightOffers) || flightOffers.length === 0) {
      console.warn(
        '⚠️ Booking.com flights search returned no offers for',
        params.origin,
        '→',
        params.destination,
      );
      return [];
    }

    const mapped = flightOffers.map((offer: any, index: number) =>
      this.transformBookingComFlightOffer(offer, index),
    );

    console.log(
      `✅ Booking.com flights search returned ${mapped.length} offers for`,
      params.origin,
      '→',
      params.destination,
    );
    return mapped;
  }

  // map Booking.com offer → UI flight shape
  private transformBookingComFlightOffer(offer: any, index: number): any {
    const segments: any[] = Array.isArray(offer?.segments)
      ? offer.segments
      : [];
    const firstSegment = segments[0];
    const firstLeg = firstSegment?.legs?.[0];

    const departureAirport = firstLeg?.departureAirport || firstSegment?.departureAirport;
    const arrivalAirport = firstLeg?.arrivalAirport || firstSegment?.arrivalAirport;

    const departureCode = departureAirport?.code || '';
    const arrivalCode = arrivalAirport?.code || '';

    const departureTimeStr = firstLeg?.departureTime || firstSegment?.departureTime;
    const arrivalTimeStr = firstLeg?.arrivalTime || firstSegment?.arrivalTime;

    const depDateObj = departureTimeStr ? new Date(departureTimeStr) : null;
    const arrDateObj = arrivalTimeStr ? new Date(arrivalTimeStr) : null;

    const departureTime = depDateObj
      ? depDateObj.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '00:00';
    const departureDate = depDateObj
      ? depDateObj.toISOString().slice(0, 10)
      : undefined;

    const arrivalTime = arrDateObj
      ? arrDateObj.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '00:00';
    const arrivalDate = arrDateObj
      ? arrDateObj.toISOString().slice(0, 10)
      : undefined;

    const totalTimeSeconds =
      typeof firstSegment?.totalTime === 'number'
        ? firstSegment.totalTime
        : Array.isArray(firstSegment?.legs) &&
            typeof firstSegment.legs[0]?.totalTime === 'number'
          ? firstSegment.legs[0].totalTime
          : undefined;

    const duration =
      typeof totalTimeSeconds === 'number'
        ? this.formatDurationFromSeconds(totalTimeSeconds)
        : departureTimeStr && arrivalTimeStr
          ? this.calculateDuration(departureTimeStr, arrivalTimeStr)
          : '0h 0m';

    const legs: any[] = Array.isArray(firstSegment?.legs)
      ? firstSegment.legs
      : [];
    const stops =
      Array.isArray(firstSegment?.flightStops) &&
      firstSegment.flightStops.length > 0
        ? firstSegment.flightStops.length
        : Math.max(0, legs.length - 1);

    const legFlightInfo = firstLeg?.flightInfo || {};
    const carrierInfo = legFlightInfo.carrierInfo || {};
    const marketingCarrierCode = carrierInfo.marketingCarrier || '';
    const flightNumberRaw = legFlightInfo.flightNumber;
    const flightNumber = [
      marketingCarrierCode,
      flightNumberRaw ? String(flightNumberRaw) : '',
    ]
      .filter(Boolean)
      .join(' ');

    const carriersData: any[] = Array.isArray(firstLeg?.carriersData)
      ? firstLeg.carriersData
      : [];
    const firstCarrier = carriersData[0] || {};

    const airlineName =
      firstCarrier?.name ||
      this.getAirlineName(
        typeof marketingCarrierCode === 'string'
          ? marketingCarrierCode.slice(0, 2)
          : '',
      ) ||
      'Airline';

    const baggageSummary = offer?.includedProducts;

    const unifiedPrice = offer?.unifiedPriceBreakdown?.price;
    const priceRounded = offer?.priceBreakdown?.totalRounded;
    let price =
      typeof priceRounded?.units === 'number'
        ? priceRounded.units
        : typeof unifiedPrice?.units === 'number'
          ? unifiedPrice.units
          : offer?.priceBreakdown?.total?.units;

    if (typeof price === 'number' && !Number.isNaN(price)) {
      price = Math.floor(price);
    } else {
      price = 0;
    }

    const cabinClass =
      firstLeg?.cabinClass ||
      offer?.brandedFareInfo?.cabinClass ||
      'ECONOMY';

    const image =
      firstCarrier?.logo ||
      'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&h=300&fit=crop';

    const token = offer?.token;

    return {
      id:
        offer?.flightKey ||
        offer?.offerKeyToHighlight ||
        token ||
        `bcom-flight-${index}`,
      airline: airlineName,
      flightNumber,
      departure: {
        airport: this.getAirportName(
          typeof departureCode === 'string'
            ? departureCode.slice(0, 3)
            : departureCode,
        ),
        code:
          typeof departureCode === 'string'
            ? departureCode.slice(0, 3)
            : departureCode,
        time: departureTime,
        date: departureDate,
      },
      arrival: {
        airport: this.getAirportName(
          typeof arrivalCode === 'string'
            ? arrivalCode.slice(0, 3)
            : arrivalCode,
        ),
        code:
          typeof arrivalCode === 'string'
            ? arrivalCode.slice(0, 3)
            : arrivalCode,
        time: arrivalTime,
        date: arrivalDate,
      },
      duration,
      stops,
      price,
      class: cabinClass,
      image,
      rating: 4.5,
      reviewCount: 500,
      baggage: baggageSummary,
      bookingComToken: token,
      rawOffer: offer,
      // stub amadeusData so UI still shows Book
      amadeusData: token
        ? { source: 'BOOKING_COM', token, itineraries: [{ segments: [{ departure: { iataCode: departureCode, at: departureTimeStr }, arrival: { iataCode: arrivalCode, at: arrivalTimeStr } }] }] }
        : undefined,
    };
  }

  private formatDurationFromSeconds(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  // legacy Kiwi host: retry with Airport: prefix
  private async searchFlightsKiwiFallback(params: {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate?: string;
    adults: number;
  }): Promise<any[]> {
    if (!this.rapidApiHost.includes('kiwi-com-cheap-flights')) return [];
    const base = `https://${this.rapidApiHost}`;
    const url = new URL(`${base}/one-way`);
    url.searchParams.set('source', `Airport:${params.origin}`);
    url.searchParams.set('destination', `Airport:${params.destination}`);
    url.searchParams.set('currency', 'usd');
    url.searchParams.set('locale', 'en');
    url.searchParams.set('adults', String(params.adults));
    url.searchParams.set('limit', '50');
    url.searchParams.set('outbound', params.departureDate);
    if (params.returnDate) url.searchParams.set('inbound', params.returnDate);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'x-rapidapi-key': this.rapidApiKey, 'x-rapidapi-host': this.rapidApiHost },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return this.extractKiwiFlightList(data);
    } catch {
      return [];
    }
  }

  // pull flight array from whatever shape RapidAPI returns
  private extractKiwiFlightList(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    const arr =
      data.data ??
      data.deals ??
      data.flights ??
      data.results ??
      data.itineraries ??
      data.items ??
      data.search_results;
    if (Array.isArray(arr)) return arr;
    if (data.data && Array.isArray(data.data.itineraries)) return data.data.itineraries;
    if (data.data && Array.isArray(data.data.data)) return data.data.data;
    if (data.data && Array.isArray(data.data.flights)) return data.data.flights;
    if (data.data && Array.isArray(data.data.deals)) return data.data.deals;
    for (const v of Object.values(data)) {
      if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') return v as any[];
    }
    return [];
  }

  // map Kiwi results → UI shape (+ Kiwi redirect stub)
  private transformKiwiResponse(
    items: any[],
    search: {
      origin: string;
      destination: string;
      departureDate: string;
      adults: number;
    },
  ): any[] {
    const adults = search.adults;
    const segmentLike = {
      departure: {
        iataCode: search.origin,
        at: `${search.departureDate}T00:00:00`,
      },
      arrival: { iataCode: search.destination },
    };
    const amadeusDataForRedirect = {
      itineraries: [{ segments: [segmentLike] }],
      travelerPricings: Array.from({ length: adults }, () => ({})),
    };

    return items.slice(0, 100).map((item: any, index: number) => {
      const price = this.parseKiwiPrice(item);
      const dep = this.parseKiwiDeparture(item);
      const arr = this.parseKiwiArrival(item);
      const duration = this.parseKiwiDuration(item);
      const airline = this.parseKiwiAirline(item);
      const flightNumber = this.parseKiwiFlightNumber(item);

      return {
        id: item?.id ?? item?.booking_token ?? `kiwi-${index}`,
        airline: airline || 'Airline',
        flightNumber: flightNumber || `${search.origin}-${search.destination}`,
        departure: {
          airport: this.getAirportName(dep.code || search.origin),
          code: dep.code || search.origin,
          time: dep.time,
          date: dep.date || search.departureDate,
        },
        arrival: {
          airport: this.getAirportName(arr.code || search.destination),
          code: arr.code || search.destination,
          time: arr.time,
          date: arr.date || search.departureDate,
        },
        duration: duration || '0h 0m',
        stops: this.parseKiwiStops(item),
        price,
        class: 'Economy',
        image: KIWI_FLIGHTS_IMAGE,
        rating: 4.5,
        reviewCount: 500,
        amadeusData: amadeusDataForRedirect,
        searchTimestamp: new Date().toISOString(),
      };
    });
  }

  private parseKiwiPrice(item: any): number {
    if (typeof item?.price === 'number') return item.price;
    if (typeof item?.conversion?.USD === 'number') return item.conversion.USD;
    if (typeof item?.fare?.total === 'number') return item.fare.total;
    const raw =
      item?.price ??
      item?.conversion?.USD ??
      item?.fare?.total ??
      item?.totalPrice ??
      item?.amount ??
      item?.price?.amount ??
      item?.money?.amount ??
      item?.total?.amount;
    const p = typeof raw === 'object' && raw != null && 'amount' in raw ? (raw as any).amount : raw;
    return typeof p === 'string' ? parseFloat(p) || 0 : Number(p) || 0;
  }

  private parseKiwiDeparture(item: any): { code?: string; time: string; date?: string } {
    const seg = item?.route?.[0] ?? item?.segments?.[0] ?? item?.legs?.[0];
    const dt =
      seg?.local_departure ??
      seg?.departure ??
      seg?.departure_time ??
      item?.local_departure ??
      item?.departure_date ??
      item?.departureDate ??
      item?.outbound ??
      item?.departure ??
      seg?.departure?.at;
    const at = dt ? new Date(dt) : null;
    const code =
      item?.source?.legacyId ??
      seg?.flyFrom ??
      seg?.origin ??
      item?.flyFrom ??
      item?.from ??
      item?.origin ??
      item?.departure_airport;
    return {
      code: typeof code === 'string' ? code.slice(0, 3) : code,
      time: at ? at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '00:00',
      date: at ? at.toISOString().slice(0, 10) : undefined,
    };
  }

  private parseKiwiArrival(item: any): { code?: string; time: string; date?: string } {
    const seg =
      item?.route?.slice(-1)?.[0] ??
      item?.route?.[item?.route?.length - 1] ??
      item?.segments?.slice(-1)?.[0] ??
      item?.legs?.slice(-1)?.[0];
    const dt =
      seg?.local_arrival ??
      seg?.arrival ??
      seg?.arrival_time ??
      item?.local_arrival ??
      item?.arrival_date ??
      item?.arrivalDate ??
      item?.arrival ??
      seg?.arrival?.at;
    const at = dt ? new Date(dt) : null;
    const code =
      item?.destination?.legacyId ??
      item?.target?.legacyId ??
      seg?.flyTo ??
      seg?.destination ??
      item?.flyTo ??
      item?.to ??
      item?.destination ??
      item?.arrival_airport;
    return {
      code: typeof code === 'string' ? code.slice(0, 3) : code,
      time: at ? at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '00:00',
      date: at ? at.toISOString().slice(0, 10) : undefined,
    };
  }

  private parseKiwiDuration(item: any): string {
    const d = item?.duration?.total ?? item?.duration?.departure ?? item?.duration;
    if (typeof d === 'number') {
      const h = Math.floor(d / 3600);
      const m = Math.floor((d % 3600) / 60);
      return `${h}h ${m}m`;
    }
    if (typeof d === 'object' && d?.hours != null) return `${d.hours}h ${d.minutes || 0}m`;
    return '0h 0m';
  }

  private parseKiwiAirline(item: any): string {
    const code =
      item?.airlines?.[0] ?? item?.carrier ?? item?.route?.[0]?.airline ?? item?.airline ?? item?.airline_name;
    if (typeof code === 'string') return this.getAirlineName(code.slice(0, 2)) || code;
    return this.getAirlineName(String(code ?? '').slice(0, 2)) || 'Airline';
  }

  private parseKiwiFlightNumber(item: any): string {
    const code =
      item?.airlines?.[0] ?? item?.carrier ?? item?.route?.[0]?.airline ?? item?.airline ?? '';
    const num =
      item?.route?.[0]?.flight_no ??
      item?.flight_no ??
      item?.route?.[0]?.operating_flight_no ??
      item?.flight_number ??
      '';
    return [code, num].filter(Boolean).join(' ') || '';
  }

  private parseKiwiStops(item: any): number {
    const r = item?.route ?? item?.segments ?? item?.legs;
    return Array.isArray(r) ? Math.max(0, r.length - 1) : 0;
  }

  private calculateDuration(departure: string, arrival: string): string {
    const dep = new Date(departure);
    const arr = new Date(arrival);
    const diffMs = arr.getTime() - dep.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }

  private getAirlineName(code: string): string {
    const airlines: { [key: string]: string } = {
      AA: 'American Airlines',
      UA: 'United Airlines',
      DL: 'Delta Airlines',
      WN: 'Southwest Airlines',
      B6: 'JetBlue',
      AS: 'Alaska Airlines',
      F9: 'Frontier Airlines',
      NK: 'Spirit Airlines',
      LH: 'Lufthansa',
      BA: 'British Airways',
      AF: 'Air France',
      KL: 'KLM',
      LX: 'Swiss',
      OS: 'Austrian Airlines',
    };
    return airlines[code] || code;
  }

  private getAirportName(code: string): string {
    const airports: { [key: string]: string } = {
      AUS: 'Austin-Bergstrom',
      SFO: 'San Francisco Intl',
      JFK: 'John F. Kennedy Intl',
      LAX: 'Los Angeles Intl',
      ORD: "Chicago O'Hare",
      DFW: 'Dallas/Fort Worth',
      DEN: 'Denver Intl',
      ATL: 'Hartsfield-Jackson Atlanta',
      MIA: 'Miami Intl',
      SEA: 'Seattle-Tacoma Intl',
      LHE: 'Lahore Allama Iqbal',
      KHI: 'Karachi Jinnah Intl',
      ISB: 'Islamabad Benazir Bhutto',
      DXB: 'Dubai Intl',
      AUH: 'Abu Dhabi Intl',
      LHR: 'London Heathrow',
      CDG: 'Paris Charles de Gaulle',
      DEL: 'New Delhi Indira Gandhi',
      BOM: 'Mumbai Chhatrapati Shivaji',
    };
    return airports[code] || `${code} Airport`;
  }

  // Amadeus price check before booking
  async validateFlightPrice(flightOffer: any) {
    if (!this.amadeus) {
      throw new HttpException(
        'Flight booking is via Kiwi.com. Use the "Book Flight" button to redirect and book on Kiwi.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      console.log('💰 Validating flight price...');
      console.log('📋 Flight offer ID:', flightOffer.id);
      console.log('📋 Flight offer source:', flightOffer.source);

      const requestBody = {
        data: {
          type: 'flight-offers-pricing',
          flightOffers: [flightOffer],
        },
      };

      console.log('📤 Sending price validation request to Amadeus...');
      console.log('📦 Request structure:', {
        type: requestBody.data.type,
        flightOffersCount: requestBody.data.flightOffers.length,
        firstOfferId: requestBody.data.flightOffers[0]?.id,
      });

      // 90s timeout — Amadeus can be slow
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error('Amadeus Price API request timeout after 90 seconds'),
            ),
          90000,
        );
      });

      console.log('⏱️ Starting Amadeus API call with 90s timeout...');
      const startTime = Date.now();

      if (
        !this.amadeus.shopping ||
        !this.amadeus.shopping.flightOffers ||
        !this.amadeus.shopping.flightOffers.pricing
      ) {
        console.error('❌ Amadeus SDK structure:', {
          hasShopping: !!this.amadeus.shopping,
          hasFlightOffers: !!this.amadeus.shopping?.flightOffers,
          hasPricing: !!this.amadeus.shopping?.flightOffers?.pricing,
          shoppingKeys: this.amadeus.shopping
            ? Object.keys(this.amadeus.shopping)
            : [],
        });
        throw new Error(
          'Amadeus flightOffers.pricing API is not available. Price validation cannot be performed.',
        );
      }

      const apiPromise =
        this.amadeus.shopping.flightOffers.pricing.post(requestBody);

      const response = (await Promise.race([
        apiPromise,
        timeoutPromise,
      ])) as any;

      const elapsedTime = Date.now() - startTime;
      console.log(`✅ Amadeus API responded in ${elapsedTime}ms`);

      if (
        !response.data ||
        !response.data.flightOffers ||
        response.data.flightOffers.length === 0
      ) {
        throw new Error('No validated flight offer returned from Amadeus');
      }

      const validatedOffer = response.data.flightOffers[0];
      const validatedPrice = parseFloat(validatedOffer.price.total);

      console.log('✅ Price validated:', {
        originalPrice: flightOffer.price?.total,
        validatedPrice: validatedPrice,
        offerId: validatedOffer.id,
      });

      return {
        validatedOffer,
        validatedPrice,
        offerId: validatedOffer.id,
        priceBreakdown: validatedOffer.price,
      };
    } catch (error: any) {
      console.error('❌ Amadeus Price Validation Error:', error.message);
      console.error('❌ Error type:', error.constructor.name);
      console.error('❌ Full error details:', {
        message: error.message,
        description: error.description,
        code: error.code,
        statusCode: error.response?.statusCode,
        responseBody: error.response?.body,
        responseData: error.response?.data,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      });

      if (error.message?.includes('timeout')) {
        throw new HttpException(
          'Amadeus API is taking too long to respond. The service might be slow or unavailable. Please try again.',
          HttpStatus.REQUEST_TIMEOUT,
        );
      }

      // unpack Amadeus / response error shapes
      let errorMessage = error.message || 'Failed to validate flight price';

      if (error.description) {
        if (Array.isArray(error.description) && error.description.length > 0) {
          const firstError = error.description[0];
          errorMessage = firstError.detail || firstError.title || errorMessage;
        } else if (typeof error.description === 'string') {
          errorMessage = error.description;
        }
      }

      if (
        error.response?.data?.errors &&
        Array.isArray(error.response.data.errors)
      ) {
        const firstError = error.response.data.errors[0];
        errorMessage = firstError.detail || firstError.title || errorMessage;
      }

      console.error('❌ Final error message to throw:', errorMessage);
      console.error('❌ Error structure check:', {
        hasDescription: !!error.description,
        descriptionType: error.description ? typeof error.description : 'none',
        hasResponseData: !!error.response?.data,
        hasResponseDataErrors: !!error.response?.data?.errors,
      });

      // friendlier copy for common test-env failures
      if (
        errorMessage.includes('NetworkError') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('timeout')
      ) {
        errorMessage =
          'Amadeus API is currently unavailable. This flight may no longer be available. Please search for flights again.';
      } else if (
        errorMessage.includes('Not Found') ||
        errorMessage.includes('not found')
      ) {
        errorMessage =
          'This flight is no longer available. Flight availability changes frequently. Please search for flights again to see current options.';
      } else if (errorMessage === 'Failed to validate flight price') {
        errorMessage =
          'Unable to verify current flight price. This may be due to Amadeus test API limitations or the flight is no longer available. Please search for flights again.';
      }

      throw new HttpException(
        errorMessage,
        error.response?.statusCode || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private getOrderStatus(orderData: any): string {
    if (orderData.type) return orderData.type;
    if (orderData.status) return orderData.status;
    // GDS record usually means tickets issued
    if (
      orderData.associatedRecords?.some(
        (r: any) => r.originSystemCode === 'GDS',
      )
    ) {
      return 'TICKETED';
    }
    return 'CONFIRMED';
  }

  async createFlightOrder(params: {
    validatedOffer: any;
    passengers: Array<{
      title: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string;
      nationality: string;
      passportNumber?: string;
      passportExpiry?: string;
      email: string;
      phone?: string;
    }>;
    contacts: Array<{
      emailAddress: string;
      phoneNumber?: string;
      address?: {
        street?: string;
        city?: string;
        postalCode?: string;
        country?: string;
      };
    }>;
    ancillaryServices?: Array<{
      type: string;
      quantity?: number;
      price?: {
        currency?: string;
        total?: string;
      };
    }>;
  }) {
    if (!this.amadeus) {
      throw new HttpException(
        'Flight booking is via Kiwi.com. Use the "Book Flight" button to redirect and book on Kiwi.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      console.log('✈️ Creating flight order with Amadeus...');

      // passengers → Amadeus travelers
      const travelers = params.passengers.map((passenger, index) => {
        const traveler: any = {
          id: String(index + 1),
          dateOfBirth: passenger.dateOfBirth,
          name: {
            firstName: passenger.firstName,
            lastName: passenger.lastName,
          },
          gender:
            passenger.title === 'Mr'
              ? 'MALE'
              : passenger.title === 'Mrs'
                ? 'FEMALE'
                : 'MALE',
          contact: {
            emailAddress: passenger.email,
            phones: passenger.phone
              ? [
                  {
                    deviceType: 'MOBILE',
                    countryCallingCode: '1',
                    number: passenger.phone.replace(/\D/g, ''),
                  },
                ]
              : [],
          },
        };

        if (passenger.passportNumber && passenger.passportExpiry) {
          traveler.documents = [
            {
              documentType: 'PASSPORT',
              number: passenger.passportNumber,
              expiryDate: passenger.passportExpiry,
              issuanceCountry: passenger.nationality,
              validityCountry: passenger.nationality,
              nationality: passenger.nationality,
              holder: true,
            },
          ];
        }

        return traveler;
      });

      // Amadeus requires address on contacts
      const contacts = params.contacts.map((contact, index) => ({
        addresseeName: {
          firstName: params.passengers[index]?.firstName || '',
          lastName: params.passengers[index]?.lastName || '',
        },
        companyName: 'Individual',
        purpose: 'LEISURE',
        phones: contact.phoneNumber
          ? [
              {
                deviceType: 'MOBILE',
                countryCallingCode: '92',
                number: contact.phoneNumber.replace(/\D/g, '').slice(-10),
              },
            ]
          : [],
        emailAddress: contact.emailAddress,
        address: {
          lines: [contact.address?.street || 'Main Street'],
          postalCode: contact.address?.postalCode || '54000',
          cityName: contact.address?.city || 'Lahore',
          countryCode: params.passengers[index]?.nationality || 'PK',
        },
      }));

      const requestBody: any = {
        data: {
          type: 'flight-order',
          flightOffers: [params.validatedOffer],
          travelers,
          contacts,
        },
      };

      if (params.ancillaryServices && params.ancillaryServices.length > 0) {
        console.log(
          '🎒 Adding ancillary services to booking request:',
          params.ancillaryServices,
        );
        requestBody.data.ancillaryServices = params.ancillaryServices;
      }

      console.log('📤 Sending booking request to Amadeus...');
      console.log('👥 Travelers:', travelers.length);
      console.log(
        '🎒 Ancillary Services:',
        params.ancillaryServices?.length || 0,
      );

      if (!this.amadeus) {
        throw new Error('Amadeus client is not initialized');
      }

      if (!this.amadeus.booking) {
        console.error('❌ this.amadeus.booking is undefined');
        console.error('❌ Amadeus client structure:', {
          hasAmadeus: !!this.amadeus,
          amadeusKeys: this.amadeus ? Object.keys(this.amadeus) : [],
        });
        throw new Error(
          'Amadeus booking API is not available. Client may not be properly initialized.',
        );
      }

      if (!this.amadeus.booking.flightOrders) {
        console.error('❌ this.amadeus.booking.flightOrders is undefined');
        console.error(
          '❌ Available booking methods:',
          Object.keys(this.amadeus.booking),
        );
        throw new Error('Amadeus flightOrders API is not available.');
      }

      if (typeof this.amadeus.booking.flightOrders.post !== 'function') {
        console.error(
          '❌ this.amadeus.booking.flightOrders.post is not a function',
        );
        console.error(
          '❌ flightOrders type:',
          typeof this.amadeus.booking.flightOrders,
        );
        console.error(
          '❌ flightOrders keys:',
          Object.keys(this.amadeus.booking.flightOrders),
        );
        throw new Error('Amadeus flightOrders.post method is not available.');
      }

      console.log(
        '✅ Amadeus SDK structure verified - using flightOrders.post()',
      );

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error('Amadeus Booking API request timeout after 90 seconds'),
            ),
          90000,
        );
      });

      console.log('⏱️ Starting Amadeus booking API call with 90s timeout...');
      const startTime = Date.now();

      // SDK v11 wants the object, not a JSON string
      const apiPromise = this.amadeus.booking.flightOrders.post(requestBody);

      const response = (await Promise.race([
        apiPromise,
        timeoutPromise,
      ])) as any;

      const elapsedTime = Date.now() - startTime;
      console.log(`✅ Amadeus booking API responded in ${elapsedTime}ms`);

      if (!response.data || !response.data.id) {
        throw new Error('No order ID returned from Amadeus');
      }

      const orderId = response.data.id;
      const orderData = response.data;
      const orderStatus = this.getOrderStatus(orderData);

      console.log('✅ Flight order created successfully:', {
        orderId,
        status: orderStatus,
        associatedRecords: orderData.associatedRecords?.length || 0,
      });

      return {
        orderId,
        orderData,
        bookingReference:
          orderData.associatedRecords?.[0]?.reference || orderId,
        status: orderStatus,
        needsTicketing: orderStatus !== 'TICKETED',
      };
    } catch (error: any) {
      console.error('❌ Amadeus Booking Error:', error.message);
      console.error('❌ Error type:', error.constructor?.name);
      console.error('❌ Error code:', error.code);
      console.error('❌ Full error details:', {
        message: error.message,
        description: error.description,
        code: error.code,
        statusCode: error.response?.statusCode,
        responseBody: error.response?.body,
        responseData: error.response?.data,
        errorDetails: error.response?.result?.errors,
      });

      // SEGMENT SELL FAILURE = schedule mismatch / sold out
      let errorDetails: any[] = [];
      if (Array.isArray(error.description)) {
        errorDetails = error.description;
      } else if (error.response?.result?.errors) {
        errorDetails = error.response.result.errors;
      } else if (error.response?.data?.errors) {
        errorDetails = error.response.data.errors;
      }

      const scheduleError = errorDetails.find(
        (e: any) => e?.code === 34651 || e?.title === 'SEGMENT SELL FAILURE',
      );

      if (scheduleError) {
        console.error('🔄 Schedule mismatch detected:', scheduleError.detail);

        /*
         * Amadeus test often returns SEGMENT SELL FAILURE as a false positive.
         * We still block booking either way — ask user to re-search.
         */
        const errorDetail = (scheduleError.detail || '').toLowerCase();
        const realScheduleChangeIndicators = [
          'departure time changed',
          'arrival time changed',
          'flight number changed',
          'aircraft type changed',
          'route changed',
          'schedule modification',
          'flight cancelled',
          'no longer operates',
          'discontinued',
        ];
        const hasStrongEvidence = realScheduleChangeIndicators.some(
          (indicator) => errorDetail.includes(indicator),
        );

        if (hasStrongEvidence) {
          console.error('❌ Real schedule change detected - blocking booking');
        } else {
          console.error('❌ Schedule mismatch detected - blocking booking');
        }
        throw new HttpException(
          'This flight is no longer available due to a schedule change. Please search for flights again to see current options.',
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        `Amadeus booking failed: ${error.code || error.message || 'Unknown error'}`,
        error.response?.statusCode || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async issueFlightTickets(orderId: string) {
    if (!this.amadeus) {
      throw new HttpException(
        'Flight booking is via Kiwi.com. Use the "Book Flight" button to redirect and book on Kiwi.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      console.log('🎫 Issuing tickets for order:', orderId);

      if (!this.amadeus?.booking?.flightOrders?.issueTicket) {
        console.error('❌ Issue ticket API not available');
        console.error(
          '❌ flightOrders structure:',
          this.amadeus?.booking?.flightOrders
            ? Object.keys(this.amadeus.booking.flightOrders)
            : 'undefined',
        );
        throw new Error('Amadeus issue ticket API is not available.');
      }

      if (
        typeof this.amadeus.booking.flightOrders.issueTicket.post !== 'function'
      ) {
        throw new Error('Amadeus issueTicket.post method is not available.');
      }

      console.log('✅ Using flightOrders.issueTicket.post() method');

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                'Amadeus Issue Ticket API request timeout after 90 seconds',
              ),
            ),
          90000,
        );
      });

      console.log('⏱️ Starting Amadeus ticketing API call with 90s timeout...');
      const startTime = Date.now();

      const apiPromise = this.amadeus.booking.flightOrders.issueTicket.post({
        data: { orderId },
      });

      const response = (await Promise.race([
        apiPromise,
        timeoutPromise,
      ])) as any;

      const elapsedTime = Date.now() - startTime;
      console.log(`✅ Amadeus ticketing API responded in ${elapsedTime}ms`);

      if (!response.data) {
        throw new Error('No response from ticket issuance API');
      }

      console.log('✅ Tickets issued successfully:', {
        orderId: response.data.id || orderId,
        status: response.data.type || 'TICKETED',
      });

      return {
        success: true,
        orderId: response.data.id || orderId,
        status: response.data.type || 'TICKETED',
        ticketData: response.data,
      };
    } catch (error: any) {
      console.error('❌ Amadeus Issue Ticket Error:', error);
      console.error('❌ Error details:', {
        message: error.message,
        description: error.description,
        code: error.code,
        response: error.response?.data,
      });
      throw new HttpException(
        error.description || error.message || 'Failed to issue tickets',
        error.response?.statusCode || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getFlightOrder(orderId: string) {
    if (!this.amadeus) {
      throw new HttpException(
        'Flight booking is via Kiwi.com. Use the "Book Flight" button to redirect and book on Kiwi.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      console.log('🎫 Fetching flight order details:', orderId);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('Amadeus Order API request timeout')),
          30000,
        );
      });

      const apiPromise = this.amadeus.booking.flightOrder(orderId).get();
      const response = (await Promise.race([
        apiPromise,
        timeoutPromise,
      ])) as any;

      if (!response.data) {
        throw new Error('No order data returned from Amadeus');
      }

      const orderStatus = this.getOrderStatus(response.data);
      const tickets = this.extractTicketInfo(response.data);

      console.log('✅ Flight order retrieved:', {
        orderId: response.data.id,
        status: orderStatus,
        travelers: response.data.travelers?.length || 0,
        ticketsCount: tickets.length,
      });

      return {
        orderId: response.data.id,
        orderData: response.data,
        tickets,
        status: orderStatus,
        isTicketed: orderStatus === 'TICKETED',
      };
    } catch (error: any) {
      console.error('❌ Amadeus Get Order Error:', error);
      throw new HttpException(
        error.description || error.message || 'Failed to retrieve flight order',
        error.response?.statusCode || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private extractTicketInfo(orderData: any) {
    const tickets: any[] = [];

    if (orderData.associatedRecords) {
      orderData.associatedRecords.forEach((record: any) => {
        if (record.reference) {
          tickets.push({
            reference: record.reference,
            creationDate: record.creationDate,
            originSystemCode: record.originSystemCode,
            flightOfferId: record.flightOfferId,
          });
        }
      });
    }

    return tickets;
  }

  // create order, optionally issue tickets, then re-fetch
  async completeFlightBooking(params: {
    validatedOffer: any;
    passengers: Array<{
      title: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string;
      nationality: string;
      passportNumber?: string;
      passportExpiry?: string;
      email: string;
      phone?: string;
    }>;
    contacts: Array<{
      emailAddress: string;
      phoneNumber?: string;
      address?: {
        street?: string;
        city?: string;
        postalCode?: string;
        country?: string;
      };
    }>;
    ancillaryServices?: Array<{
      type: string;
      quantity?: number;
      price?: {
        currency?: string;
        total?: string;
      };
    }>;
    autoIssueTickets?: boolean;
  }) {
    try {
      console.log('🔄 Starting complete flight booking flow...');

      if (params.ancillaryServices && params.ancillaryServices.length > 0) {
        console.log(
          '🎒 Ancillary services requested:',
          params.ancillaryServices,
        );
      }

      const orderResult = await this.createFlightOrder({
        validatedOffer: params.validatedOffer,
        passengers: params.passengers,
        contacts: params.contacts,
        ancillaryServices: params.ancillaryServices,
      });

      let finalOrderData = orderResult.orderData;
      let tickets = this.extractTicketInfo(orderResult.orderData);
      let ticketingStatus = orderResult.status;

      if (orderResult.needsTicketing && params.autoIssueTickets !== false) {
        console.log('🎫 Order is not ticketed. Attempting to issue tickets...');

        try {
          await this.issueFlightTickets(orderResult.orderId);

          // brief pause — some providers need it before tickets show up
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const updatedOrder = await this.getFlightOrder(orderResult.orderId);
          finalOrderData = updatedOrder.orderData;
          tickets = updatedOrder.tickets;
          ticketingStatus = updatedOrder.status;

          console.log('✅ Tickets issued and retrieved:', {
            ticketsCount: tickets.length,
            status: ticketingStatus,
          });
        } catch (ticketingError: any) {
          // test env often lacks issueTicket — order still counts as created
          if (ticketingError.message?.includes('not available')) {
            console.log(
              'ℹ️ Ticket issuance API not available in test environment (this is expected)',
            );
            console.log(
              '✅ Booking order created successfully - tickets can be issued later if needed',
            );
          } else {
            console.error(
              '⚠️ Ticket issuance failed, but order was created:',
              ticketingError.message,
            );
            console.log(
              '✅ Booking order created successfully - tickets can be issued later if needed',
            );
          }
        }
      } else if (!orderResult.needsTicketing) {
        console.log('✅ Order already ticketed, no need to issue tickets');
      } else {
        console.log(
          '⏸️ Auto-ticketing disabled, order created but tickets not issued',
        );
      }

      return {
        orderId: orderResult.orderId,
        orderData: finalOrderData,
        bookingReference: orderResult.bookingReference,
        tickets,
        status: ticketingStatus,
        isTicketed: ticketingStatus === 'TICKETED',
      };
    } catch (error: any) {
      console.error('❌ Complete booking flow error:', error);
      throw error;
    }
  }
}
