import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpException,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { FlightsService } from './flights.service';

@Controller('travel/flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Get('test')
  async testEndpoint() {
    try {
      console.log('🧪 Test endpoint called');
      const testDate = new Date();
      testDate.setDate(testDate.getDate() + 30);
      const dateStr = testDate.toISOString().split('T')[0];

      const flights = await this.flightsService.searchFlights({
        originLocationCode: 'LHE',
        destinationLocationCode: 'KHI',
        departureDate: dateStr,
        adults: 1,
      });

      return {
        success: true,
        message: 'API is working!',
        testParams: {
          from: 'LHE (Lahore)',
          to: 'KHI (Karachi)',
          date: dateStr,
        },
        flightsFound: flights.length,
        flights: flights,
      };
    } catch (error: any) {
      console.error('❌ Test endpoint error:', error);
      throw new HttpException(
        {
          success: false,
          error: error.message,
          details: error.response?.data || error,
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // async search — returns id for polling
  @Post('search')
  async startSearch(
    @Body()
    body: {
      from: string;
      to: string;
      date?: string;
      returnDate?: string;
      adults?: number;
    },
  ) {
    const { from, to, date, returnDate, adults } = body;

    if (!from || !to) {
      throw new HttpException(
        'Missing required parameters: from, to',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const originCode = this.extractAirportCode(from);
      const destinationCode = this.extractAirportCode(to);

      // default ~30 days out if date omitted
      let departureDate = date;
      if (!departureDate) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
        departureDate = futureDate.toISOString().split('T')[0];
      }

      console.log('📍 Starting search:', {
        from: originCode,
        to: destinationCode,
        date: departureDate,
      });

      const searchId = await this.flightsService.startFlightSearch({
        originLocationCode: originCode,
        destinationLocationCode: destinationCode,
        departureDate: departureDate,
        returnDate: returnDate,
        adults: adults || 1,
      });

      console.log(`✅ Search started: ${searchId}`);
      return {
        searchId,
        status: 'processing',
        message:
          'Search started. Poll /results endpoint with searchId to get results.',
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to start search',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('results')
  async getSearchResults(@Query('searchId') searchId: string) {
    if (!searchId) {
      throw new HttpException('searchId is required', HttpStatus.BAD_REQUEST);
    }

    const job = this.flightsService.getSearchStatus(searchId);

    if (!job) {
      throw new HttpException(
        'Search not found or expired',
        HttpStatus.NOT_FOUND,
      );
    }

    if (job.status === 'processing') {
      return {
        status: 'processing',
        message: 'Search in progress. Please poll again in 1-2 seconds.',
      };
    }

    if (job.status === 'error') {
      throw new HttpException(
        {
          status: 'error',
          error: job.error || 'Search failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      status: 'complete',
      flights: job.results || [],
      count: job.results?.length || 0,
    };
  }

  // sync search, or popular routes when no from/to
  @Get()
  async searchFlights(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('date') date?: string,
    @Query('returnDate') returnDate?: string,
    @Query('adults') adults?: string,
    @Query('popular') popular?: string,
  ) {
    console.log('✈️ Flight search request received:', {
      from,
      to,
      date,
      returnDate,
      adults,
      popular,
    });

    if (popular === 'true' || (!from && !to && !date)) {
      return this.getPopularFlights();
    }

    if (!from || !from.trim()) {
      throw new HttpException(
        'Missing required parameter: from',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const originCode = this.extractAirportCode(from.trim());

      let departureDate = date;
      if (!departureDate) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
        departureDate = futureDate.toISOString().split('T')[0];
      }

      // from-only → fan out to popular destinations
      if (!to || !to.trim()) {
        console.log('📍 Searching flights from origin only:', originCode, departureDate);
        return this.getFlightsFromOrigin(originCode, departureDate, adults);
      }

      const destinationCode = this.extractAirportCode(to.trim());
      console.log('📍 Searching flights:', {
        from: originCode,
        to: destinationCode,
        date: departureDate,
      });

      const flights = await this.flightsService.searchFlights({
        originLocationCode: originCode,
        destinationLocationCode: destinationCode,
        departureDate: departureDate,
        returnDate: returnDate,
        adults: adults ? parseInt(adults) : 1,
      });

      return flights;
    } catch (error: any) {
      const statusCode =
        error?.status || error?.response?.statusCode || HttpStatus.INTERNAL_SERVER_ERROR;

      // surface 429 so the UI can show a clear message
      if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
        console.error('❌ Flight search hit upstream rate limit:', {
          message: error?.message,
          details: error?.response?.data || error?.response?.body,
        });
        throw new HttpException(
          'Flight search temporarily unavailable: upstream API rate limit exceeded. Please wait a few minutes and try again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // soft-fail: empty list keeps the page usable
      console.error('❌ Flight search failed, returning empty list:', {
        message: error?.message,
        status: statusCode,
      });
      return [];
    }
  }

  private extractAirportCode(input: string): string {
    const codeMatch = input.match(/\b[A-Z]{3}\b/);
    if (codeMatch) return codeMatch[0];

    const upperInput = input.toUpperCase();

    const cityToCode: { [key: string]: string } = {
      AUSTIN: 'AUS',
      'SAN FRANCISCO': 'SFO',
      'NEW YORK': 'JFK',
      'LOS ANGELES': 'LAX',
      CHICAGO: 'ORD',
      DALLAS: 'DFW',
      DENVER: 'DEN',
      ATLANTA: 'ATL',
      MIAMI: 'MIA',
      SEATTLE: 'SEA',
      LAHORE: 'LHE',
      KARACHI: 'KHI',
      ISLAMABAD: 'ISB',
      DUBAI: 'DXB',
      'ABU DHABI': 'AUH',
      LONDON: 'LHR',
      PARIS: 'CDG',
      'NEW DELHI': 'DEL',
      MUMBAI: 'BOM',
    };

    for (const [city, code] of Object.entries(cityToCode)) {
      if (upperInput.includes(city)) {
        return code;
      }
    }

    // Pakistan city name fallbacks
    if (upperInput.includes('LAHORE') || upperInput.includes('LAH')) {
      return 'LHE';
    }
    if (upperInput.includes('KARACHI') || upperInput.includes('KAR')) {
      return 'KHI';
    }
    if (upperInput.includes('ISLAMABAD') || upperInput.includes('ISL')) {
      return 'ISB';
    }

    return upperInput.substring(0, 3).padEnd(3, 'X');
  }

  private async getPopularFlights() {
    console.log('🌟 Fetching popular flights');
    const today = new Date();

    // spread across a few dates so results aren't identical
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + 30 + i);
      dates.push(futureDate.toISOString().split('T')[0]);
    }

    const popularRoutes = [
      { from: 'LHE', to: 'KHI', fromName: 'Lahore', toName: 'Karachi' },
      { from: 'KHI', to: 'LHE', fromName: 'Karachi', toName: 'Lahore' },
      { from: 'ISB', to: 'KHI', fromName: 'Islamabad', toName: 'Karachi' },
      { from: 'KHI', to: 'ISB', fromName: 'Karachi', toName: 'Islamabad' },
      { from: 'LHE', to: 'ISB', fromName: 'Lahore', toName: 'Islamabad' },
      { from: 'ISB', to: 'LHE', fromName: 'Islamabad', toName: 'Lahore' },
      { from: 'DXB', to: 'LHE', fromName: 'Dubai', toName: 'Lahore' },
      { from: 'LHE', to: 'DXB', fromName: 'Lahore', toName: 'Dubai' },
      { from: 'DXB', to: 'KHI', fromName: 'Dubai', toName: 'Karachi' },
      { from: 'KHI', to: 'DXB', fromName: 'Karachi', toName: 'Dubai' },
      { from: 'AUH', to: 'LHE', fromName: 'Abu Dhabi', toName: 'Lahore' },
      { from: 'LHE', to: 'AUH', fromName: 'Lahore', toName: 'Abu Dhabi' },
    ];

    const flightPromises: Promise<any[]>[] = [];

    // 3 dates/route — variety without hammering the API
    for (const route of popularRoutes) {
      for (const dateStr of dates.slice(0, 3)) {
        flightPromises.push(
          (async () => {
            try {
              console.log(
                `🔍 Fetching ${route.from} → ${route.to} for ${dateStr}`,
              );
              const flights = await this.flightsService.searchFlights({
                originLocationCode: route.from,
                destinationLocationCode: route.to,
                departureDate: dateStr,
                adults: 1,
              });
              console.log(
                `   ✓ Got ${flights.length} flights for ${route.from} → ${route.to} on ${dateStr}`,
              );
              return flights;
            } catch (error: any) {
              console.error(
                `❌ Error fetching flights for ${route.from} to ${route.to} on ${dateStr}:`,
                error.message || error,
              );
              return [];
            }
          })(),
        );
      }
    }

    console.log(
      `📋 Total API calls queued: ${flightPromises.length} (${popularRoutes.length} routes × ${dates.slice(0, 7).length} dates)`,
    );

    console.log(
      `🔄 Starting to fetch flights from ${flightPromises.length} route/date combinations...`,
    );
    const results = await Promise.allSettled(flightPromises);
    const allFlights: any[] = [];
    let successCount = 0;
    let failureCount = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const flights = result.value;
        if (flights && flights.length > 0) {
          allFlights.push(...flights);
          successCount++;
          console.log(`✅ Route ${index + 1}: Got ${flights.length} flights`);
        } else {
          console.log(`⚠️ Route ${index + 1}: No flights returned`);
        }
      } else {
        failureCount++;
        console.error(`❌ Route ${index + 1}: Failed -`, result.reason);
      }
    });

    console.log(
      `📊 Summary: ${successCount} successful, ${failureCount} failed, ${allFlights.length} total flights before deduplication`,
    );

    const uniqueFlights = Array.from(
      new Map(
        allFlights.map((flight) => {
          const uniqueKey = `${flight.flightNumber}-${flight.departure.time}-${flight.departure.date}-${flight.departure.code}-${flight.arrival.code}`;
          return [uniqueKey, flight];
        }),
      ).values(),
    );

    uniqueFlights.sort((a, b) => (a.price || 0) - (b.price || 0));

    console.log(
      `✅ Popular flights fetched: ${uniqueFlights.length} unique flights (${allFlights.length} before deduplication)`,
    );
    console.log(
      `📈 Flight breakdown: ${uniqueFlights.length} unique flights ready to display`,
    );
    console.log(
      `💰 Price range: $${Math.min(...uniqueFlights.map((f) => f.price || 0))} - $${Math.max(...uniqueFlights.map((f) => f.price || 0))}`,
    );
    return uniqueFlights;
  }

  // origin-only: fan out to a short list of destinations
  private async getFlightsFromOrigin(
    originCode: string,
    departureDate: string,
    adults?: string,
  ) {
    const origin = originCode.toUpperCase();
    const allDests = ['LHE', 'KHI', 'ISB', 'DXB', 'AUH', 'JFK', 'LHR', 'CDG', 'DEL', 'BOM', 'ORD', 'LAX', 'SFO', 'DEN', 'ATL', 'MIA', 'SEA', 'DFW', 'AUS'];
    const destinations = allDests.filter((d) => d !== origin);
    if (destinations.length === 0) {
      return [];
    }

    const adultCount = adults ? parseInt(adults, 10) : 1;
    const validAdults = Number.isNaN(adultCount) || adultCount < 1 ? 1 : adultCount;

    // cap + stagger batches to avoid upstream 429s
    const toFetch = destinations.slice(0, 6);
    const batch1 = toFetch.slice(0, 3);
    const batch2 = toFetch.slice(3, 6);
    const runOne = (dest: string) =>
      this.flightsService
        .searchFlights({
          originLocationCode: origin,
          destinationLocationCode: dest,
          departureDate,
          adults: validAdults,
        })
        .catch((err: any) => {
          const msg = err?.response?.body?.errors?.[0]?.detail || err?.message || err;
          if (String(msg).includes('429') || String(msg).includes('rate limit')) {
            console.warn(`Flights ${origin} → ${dest}: rate limited, skipped`);
          } else {
            console.warn(`Flights ${origin} → ${dest}:`, msg);
          }
          return [];
        });

    const results1 = await Promise.all(batch1.map((dest) => runOne(dest)));
    await new Promise((r) => setTimeout(r, 700));
    const results2 = await Promise.all(batch2.map((dest) => runOne(dest)));
    const results = [...results1, ...results2];
    const allFlights = results.flat();
    const uniqueFlights = Array.from(
      new Map(
        allFlights.map((f: any) => {
          const key = `${f.flightNumber}-${f.departure?.time}-${f.departure?.date}-${f.departure?.code}-${f.arrival?.code}`;
          return [key, f];
        }),
      ).values(),
    );
    uniqueFlights.sort((a: any, b: any) => (a.price || 0) - (b.price || 0));
    console.log(`✅ Flights from ${origin} only: ${uniqueFlights.length} flights`);
    return uniqueFlights;
  }

  @Post('validate-price')
  async validatePrice(@Body() body: { flightOffer: any }) {
    const { flightOffer } = body;

    if (!flightOffer) {
      throw new HttpException(
        'flightOffer is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.flightsService.validateFlightPrice(flightOffer);
      return {
        success: true,
        ...result,
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to validate price',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('create-order')
  async createOrder(
    @Body()
    body: {
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
      }>;
    },
  ) {
    const { validatedOffer, passengers, contacts } = body;

    if (!validatedOffer || !passengers || passengers.length === 0) {
      throw new HttpException(
        'validatedOffer and passengers are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.flightsService.createFlightOrder({
        validatedOffer,
        passengers,
        contacts:
          contacts || passengers.map((p) => ({ emailAddress: p.email })),
      });
      return {
        success: true,
        ...result,
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to create order',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('order/:orderId')
  async getOrder(@Param('orderId') orderId: string) {
    if (!orderId) {
      throw new HttpException('orderId is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.flightsService.getFlightOrder(orderId);
      return {
        success: true,
        ...result,
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to get order',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('issue-tickets/:orderId')
  async issueTickets(@Param('orderId') orderId: string) {
    if (!orderId) {
      throw new HttpException('orderId is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const result = await this.flightsService.issueFlightTickets(orderId);
      return result;
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to issue tickets',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
