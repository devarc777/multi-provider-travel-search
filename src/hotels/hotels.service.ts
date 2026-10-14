import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Amadeus from 'amadeus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HotelsService {
  // Amadeus kept for legacy booking helpers (search uses RapidAPI)
  private amadeus: Amadeus | null = null;
  private rapidApiKey: string;
  private hotelsApiHost: string;
  private hotelsSuggestHost: string;
  private bookingApiHost = 'booking-com15.p.rapidapi.com';
  private bookingDestCache: Record<string, { destId: string; searchType: string }> =
    {};

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.rapidApiKey = this.configService.get<string>('RAPIDAPI_KEY') || '';
    this.hotelsApiHost =
      this.configService.get<string>('RAPIDAPI_HOST_HOTELS_COM') ||
      'hotels-com-provider.p.rapidapi.com';
    // FREE suggest host → region id lookup
    this.hotelsSuggestHost =
      this.configService.get<string>('RAPIDAPI_HOST_HOTELS_SUGGEST') ||
      'hotels-com-free.p.rapidapi.com';

    if (!this.rapidApiKey) {
      console.warn(
        '⚠️ RAPIDAPI_KEY missing – Hotels.com / Booking.com RapidAPI integrations will not work.',
      );
    } else {
      console.log(
        '✅ HotelsService: using Hotels.com Provider via RapidAPI for hotel search',
      );
      console.log(
        '✅ HotelsService: Booking.com (booking-com15) RapidAPI key configured',
      );
    }
  }

  // city list without requiring dates from the client
  async getHotelsList(location: string) {
    try {
      console.log('🔍 Getting hotels list for location:', location);

      // default tomorrow → next day
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(tomorrow.getDate() + 1);
      const checkInDate = tomorrow.toISOString().split('T')[0];
      const checkOutDate = dayAfter.toISOString().split('T')[0];

      // Booking.com first, Hotels.com fallback
      try {
        const bookingResults = await this.searchHotelsViaBookingCom({
          city: location,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          adults: 1,
          children: 0,
          rooms: 1,
        });
        if (bookingResults.length > 0) {
          return bookingResults;
        }
      } catch (bookingError) {
        console.error(
          '❌ Booking.com RapidAPI Error (getHotelsList), falling back to Hotels.com:',
          bookingError,
        );
      }

      const regionId = await this.lookupRegionId(location);
      if (!regionId) {
        console.warn('⚠️ No regionId found for location:', location);
        return [];
      }

      return this.searchHotelsViaHotelsCom({
        regionId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        adults: 1,
        children: 0,
        rooms: 1,
        locationName: location,
      });
    } catch (error: any) {
      console.error('❌ Hotels.com Provider API Error (getHotelsList):', error);
      console.error('❌ Error details:', {
        message: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to fetch hotels from Hotels.com Provider',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getFeaturedHotels() {
    const list = await this.prisma.featuredHotel.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 5,
    });
    return list.map((h) => ({
      id: h.id,
      amadeusHotelId: h.amadeusHotelId,
      name: h.name,
      cityCode: h.cityCode,
      cityName: h.cityName,
      imageUrl: h.imageUrl,
      price: h.price,
    }));
  }

  // homepage featured list is capped at 5
  async addFeaturedHotel(body: {
    amadeusHotelId: string;
    name: string;
    cityCode: string;
    cityName?: string;
    imageUrl?: string;
    price?: string;
  }) {
    const count = await this.prisma.featuredHotel.count();
    if (count >= 5) {
      throw new HttpException(
        'Maximum of 5 hotels can be featured on homepage. Remove one first.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const nextOrder = count;
    return this.prisma.featuredHotel.create({
      data: {
        amadeusHotelId: body.amadeusHotelId,
        name: body.name,
        cityCode: body.cityCode,
        cityName: body.cityName ?? null,
        imageUrl: body.imageUrl ?? null,
        price: body.price ?? null,
        sortOrder: nextOrder,
      },
    });
  }

  async removeFeaturedHotel(id: string) {
    return this.prisma.featuredHotel.delete({
      where: { id },
    });
  }

  async searchHotels(params: {
    location: string;
    checkIn?: string;
    checkOut?: string;
    adults?: number;
    children?: number;
    rooms?: number;
  }) {
    try {
      console.log('🔍 Searching hotels with params:', params);
      let checkInDate = params.checkIn;
      let checkOutDate = params.checkOut;

      if (!checkInDate || !checkOutDate) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfter = new Date();
        dayAfter.setDate(dayAfter.getDate() + 2);
        checkInDate = tomorrow.toISOString().split('T')[0];
        checkOutDate = dayAfter.toISOString().split('T')[0];
        console.log(
          `📅 No dates provided, using default dates: ${checkInDate} to ${checkOutDate}`,
        );
      }

      if (!checkInDate || !checkOutDate) {
        throw new HttpException(
          'Check-in and check-out dates are required.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const checkInObj = new Date(checkInDate);
      const checkOutObj = new Date(checkOutDate);

      if (isNaN(checkInObj.getTime()) || isNaN(checkOutObj.getTime())) {
        throw new HttpException(
          'Invalid date format. Expected YYYY-MM-DD for check-in and check-out.',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (checkOutObj <= checkInObj) {
        throw new HttpException(
          'Check-out date must be after check-in date.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (checkInObj < today) {
        throw new HttpException(
          'Check-in date must be today or in the future.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const adults = params.adults || 1;
      const children = params.children || 0;
      const rooms = params.rooms || 1;

      // Booking.com first, Hotels.com fallback
      try {
        const bookingResults = await this.searchHotelsViaBookingCom({
          city: params.location,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          adults,
          children,
          rooms,
        });
        if (bookingResults.length > 0) {
          return bookingResults;
        }
      } catch (bookingError) {
        console.error(
          '❌ Booking.com RapidAPI Error (searchHotels), falling back to Hotels.com:',
          bookingError,
        );
      }

      const regionId = await this.lookupRegionId(params.location);
      if (!regionId) {
        console.warn(
          '⚠️ No regionId found for location in searchHotels after FREE suggest:',
          params.location,
        );
        return [];
      }

      return this.searchHotelsViaHotelsCom({
        regionId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        adults,
        children,
        rooms,
        locationName: params.location,
      });
    } catch (error: any) {
      console.error('❌ Hotels.com Provider API Error (searchHotels):', error);
      console.error('❌ Error details:', {
        message: error.message,
      });
      throw new HttpException(
        error.message || 'Failed to fetch hotels from Hotels.com Provider',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getHotelOffers(
    hotelId: string,
    params: {
      checkIn: string;
      checkOut: string;
      adults: number;
      children?: number;
      rooms?: number;
    },
  ) {
    // on-site Amadeus book disabled — frontend redirects to Booking.com
    throw new HttpException(
      'Hotel booking via API is disabled. Please use the Booking.com redirect from the frontend.',
      HttpStatus.BAD_REQUEST,
    );
  }

  async createHotelBooking(params: {
    offer: any;
    guests: Array<{
      name: {
        title: string;
        firstName: string;
        lastName: string;
      };
      contact?: {
        phoneNumber?: string;
        emailAddress?: string;
      };
    }>;
    contact: {
      emailAddress: string;
      phoneNumber?: string;
    };
    payments: Array<{
      method: string;
      card?: {
        vendorCode: string;
        cardNumber: string;
        expiryDate: string;
        holderName: string;
      };
    }>;
  }) {
    try {
      console.log('🏨 Creating hotel booking with Amadeus...');
      console.log('📤 Sending booking request to Amadeus...');
      console.log('👥 Guests:', params.guests.length);

      if (!params.offer || !params.offer.id) {
        throw new HttpException(
          'Invalid hotel offer: missing offer ID. The offer data is incomplete. Please search for hotels again and select a room.',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!params.guests || params.guests.length === 0) {
        throw new HttpException(
          'At least one guest is required for hotel booking',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!params.payments || params.payments.length === 0) {
        throw new HttpException(
          'Payment information is required for hotel booking',
          HttpStatus.BAD_REQUEST,
        );
      }

      const payment = params.payments[0];
      if (payment.method === 'CREDIT_CARD' && payment.card) {
        if (
          !payment.card.cardNumber ||
          payment.card.cardNumber.replace(/\s/g, '').length < 13
        ) {
          throw new HttpException(
            'Invalid payment card number',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (
          !payment.card.expiryDate ||
          !/^\d{4}-\d{2}$/.test(payment.card.expiryDate)
        ) {
          throw new HttpException(
            'Invalid payment card expiry date. Expected format: YYYY-MM',
            HttpStatus.BAD_REQUEST,
          );
        }
        if (
          !payment.card.holderName ||
          payment.card.holderName.trim().length === 0
        ) {
          throw new HttpException(
            'Payment card holder name is required',
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      const bookingRequest = {
        data: {
          offerId: params.offer.id,
          guests: params.guests.map((guest) => ({
            name: guest.name,
            contact: guest.contact || {},
          })),
          payments: params.payments,
        },
        contact: {
          emailAddress: params.contact.emailAddress,
          phoneNumber: params.contact.phoneNumber || '+1234567890',
        },
      };

      console.log('📋 Booking request structure:', {
        offerId: bookingRequest.data.offerId,
        guestsCount: bookingRequest.data.guests.length,
        hasPayment: bookingRequest.data.payments.length > 0,
        paymentMethod: bookingRequest.data.payments[0]?.method,
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('Amadeus hotel booking API request timeout')),
          90000,
        );
      });

      const apiPromise =
        this.amadeus.booking.hotelBookings.post(bookingRequest);
      const response = (await Promise.race([
        apiPromise,
        timeoutPromise,
      ])) as any;

      console.log('✅ Amadeus hotel booking API responded');
      console.log('📋 Booking response:', {
        id: response.data?.id,
        associatedRecords: response.data?.associatedRecords?.length || 0,
        type: response.data?.type,
      });

      if (!response.data) {
        throw new Error('Invalid response from Amadeus hotel booking API');
      }

      if (!response.data.id) {
        console.error(
          '❌ CRITICAL: Amadeus booking response missing booking ID',
        );
        throw new HttpException(
          'Hotel booking failed: Invalid response from Amadeus. No booking ID received. Booking was NOT confirmed.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const bookingId = response.data.id;
      const confirmationNumber =
        response.data.associatedRecords?.[0]?.reference || null;
      const status = response.data.type || 'hotel-booking';

      if (!bookingId) {
        console.error(
          '❌ CRITICAL: Amadeus booking response has no booking ID',
        );
        throw new HttpException(
          'Hotel booking failed: No booking ID received from Amadeus. Booking was NOT confirmed.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      console.log('✅ Hotel booking created successfully with Amadeus:', {
        bookingId,
        confirmationNumber,
        status,
        hasConfirmationNumber: !!confirmationNumber,
      });

      return {
        bookingId,
        confirmationNumber,
        status,
        bookingData: response.data,
      };
    } catch (error: any) {
      console.error('❌ Amadeus Hotel Booking Error:', error);

      // normalize Amadeus error shapes (array / object / message[])
      let errorMessage = 'Failed to create hotel booking through Amadeus';
      let errorStatus = HttpStatus.INTERNAL_SERVER_ERROR;

      if (error.description) {
        if (Array.isArray(error.description) && error.description.length > 0) {
          const firstError = error.description[0];
          errorMessage = firstError.detail || firstError.title || errorMessage;
          errorStatus = firstError.status || errorStatus;
        } else if (typeof error.description === 'string') {
          errorMessage = error.description;
        }
      }

      if (
        error.response?.data?.errors &&
        Array.isArray(error.response.data.errors) &&
        error.response.data.errors.length > 0
      ) {
        const firstError = error.response.data.errors[0];
        errorMessage = firstError.detail || firstError.title || errorMessage;
        errorStatus = firstError.status || errorStatus;
      }

      if (
        error.message &&
        Array.isArray(error.message) &&
        error.message.length > 0
      ) {
        const firstError = error.message[0];
        errorMessage = firstError.detail || firstError.title || errorMessage;
        errorStatus = firstError.status || errorStatus;
      } else if (error.message && typeof error.message === 'string') {
        errorMessage = error.message;
      }

      if (error.code === 'AuthenticationError' || errorStatus === 401) {
        const wwwAuthenticate =
          error.response?.headers?.['www-authenticate'] || '';
        if (
          wwwAuthenticate.includes('InvalidAPICallAsNoApiProductMatchFound') ||
          wwwAuthenticate.includes('no apiproduct match found')
        ) {
          errorMessage =
            'Hotel booking API is not enabled for your Amadeus API key. Please enable the "Hotel Booking" API product in your Amadeus developer account.';
        } else if (
          wwwAuthenticate.includes('invalid_token') ||
          wwwAuthenticate.includes('Invalid access token')
        ) {
          errorMessage =
            'Amadeus API authentication failed. Please check your API credentials (AMADEUS_API_KEY and AMADEUS_API_SECRET) in your .env file.';
        } else {
          errorMessage =
            'Amadeus authentication failed. Please check your API credentials and ensure the hotel booking API product is enabled.';
        }
        errorStatus = HttpStatus.UNAUTHORIZED;
      }

      console.error('❌ Error details:', {
        message: errorMessage,
        status: errorStatus,
        code: error.code,
        description: error.description,
        wwwAuthenticate: error.response?.headers?.['www-authenticate'],
        response: error.response?.data,
      });

      // fail closed — never confirm without a real booking id
      throw new HttpException(
        {
          message: errorMessage,
          code: error.code || 'AMADEUS_ERROR',
          status: errorStatus,
          details: error.description || error.response?.data,
        },
        errorStatus,
      );
    }
  }

  private extractCityCode(location: string): string {
    const codeMatch = location.match(/\b[A-Z]{3}\b/);
    if (codeMatch) return codeMatch[0];

    const cityMap: { [key: string]: string } = {
      'new york': 'NYC',
      nyc: 'NYC',
      'los angeles': 'LAX',
      lax: 'LAX',
      chicago: 'CHI',
      chi: 'CHI',
      houston: 'HOU',
      hou: 'HOU',
      phoenix: 'PHX',
      phx: 'PHX',
      philadelphia: 'PHL',
      phl: 'PHL',
      'san antonio': 'SAT',
      sat: 'SAT',
      'san diego': 'SAN',
      san: 'SAN',
      dallas: 'DFW',
      dfw: 'DFW',
      'san jose': 'SJC',
      sjc: 'SJC',
      austin: 'AUS',
      aus: 'AUS',
      miami: 'MIA',
      mia: 'MIA',
      boston: 'BOS',
      bos: 'BOS',
      seattle: 'SEA',
      sea: 'SEA',
      london: 'LON',
      lon: 'LON',
      paris: 'PAR',
      par: 'PAR',
      tokyo: 'TYO',
      tyo: 'TYO',
      dubai: 'DXB',
      dxb: 'DXB',
      singapore: 'SIN',
      sin: 'SIN',
    };

    const normalized = location.toLowerCase().trim();
    if (cityMap[normalized]) {
      return cityMap[normalized];
    }

    console.warn(`⚠️ Unknown city: ${location}, defaulting to NYC`);
    return 'NYC';
  }

  private transformHotelOffer(
    offer: any,
    hotelId: string,
    searchParams?: any,
  ): any {
    const hotel = offer.hotel || {};
    const rooms = offer.offers || [];

    let lowestPrice = 0;
    if (rooms.length > 0) {
      const prices = rooms
        .map((r: any) => {
          const price = r.price?.total || r.price?.base || r.total || '0';
          return parseFloat(price.toString());
        })
        .filter((p) => !isNaN(p) && p > 0);
      lowestPrice = prices.length > 0 ? Math.min(...prices) : 0;
    }

    const hotelName = hotel.name || 'Hotel';
    const cityCode = hotel.cityCode || searchParams?.location || '';
    const addressLine =
      hotel.address?.lines?.[0] || hotel.address?.line || hotel.address || '';
    const location = addressLine
      ? `${cityCode} ${addressLine}`.trim()
      : searchParams?.location || cityCode || 'Location not available';

    return {
      id: hotelId,
      name: hotelName,
      location: location,
      address: addressLine,
      distance: hotel.distance?.value
        ? `${hotel.distance.value} ${hotel.distance.unit}`
        : undefined,
      price: lowestPrice || 100,
      pricePerNight: true,
      rating: parseFloat(hotel.rating || hotel.hotel?.rating || '4.0'),
      reviewCount: parseInt(
        hotel.reviewCount || hotel.hotel?.reviewCount || '0',
      ),
      image:
        hotel.media?.[0]?.uri ||
        hotel.images?.[0] ||
        'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=300&fit=crop',
      images: hotel.media?.map((m: any) => m.uri) || hotel.images || [],
      amenities: hotel.amenities ||
        hotel.hotel?.amenities || ['Free WiFi', 'Parking'],
      stars: parseInt(
        hotel.hotelId?.match(/\d/)?.[0] || hotel.stars?.toString() || '4',
      ),
      cancellation:
        rooms[0]?.policies?.cancellation?.type === 'FREE_CANCELLATION'
          ? 'Free cancellation'
          : 'Non-refundable',
      rooms: rooms.length > 0 ? this.transformRooms(rooms) : [],
      description: hotel.description?.text || hotel.description || '',
      amadeusData: {
        hotel: hotel,
        offers: rooms,
      },
    };
  }

  private transformRooms(offers: any[]): any[] {
    return offers.map((offer: any) => ({
      id: offer.id,
      name: offer.room?.type || offer.type || 'Standard Room',
      type: offer.room?.type || 'STANDARD',
      price: parseFloat(offer.price?.total || offer.price?.base || '0'),
      originalPrice: offer.price?.variations?.average?.base
        ? parseFloat(offer.price.variations.average.base)
        : undefined,
      maxOccupancy: {
        adults: offer.guests?.adults || 2,
        children: offer.guests?.childAges?.length || 0,
        total:
          (offer.guests?.adults || 2) + (offer.guests?.childAges?.length || 0),
      },
      bedTypes: offer.room?.typeEstimated?.beds || ['1 Double Bed'],
      amenities: offer.room?.amenities || [],
      size: offer.room?.typeEstimated?.category || undefined,
      cancellationPolicy:
        offer.policies?.cancellation?.type === 'FREE_CANCELLATION'
          ? 'Free cancellation'
          : 'Non-refundable',
      offerId: offer.id,
      amadeusData: offer,
    }));
  }

  private transformRoomOffer(offer: any, hotelId: string): any {
    if (!offer.id) {
      console.warn('⚠️ Hotel offer missing ID, skipping:', offer);
      return null;
    }

    return {
      id: offer.id,
      name: offer.room?.type || offer.type || 'Standard Room',
      type: offer.room?.type || 'STANDARD',
      price: parseFloat(offer.price?.total || offer.price?.base || '0'),
      originalPrice: offer.price?.variations?.average?.base
        ? parseFloat(offer.price.variations.average.base)
        : undefined,
      maxOccupancy: {
        adults: offer.guests?.adults || 2,
        children: offer.guests?.childAges?.length || 0,
        total:
          (offer.guests?.adults || 2) + (offer.guests?.childAges?.length || 0),
      },
      bedTypes: offer.room?.typeEstimated?.beds || ['1 Double Bed'],
      amenities: offer.room?.amenities || [],
      size: offer.room?.typeEstimated?.category || undefined,
      cancellationPolicy:
        offer.policies?.cancellation?.type === 'FREE_CANCELLATION'
          ? 'Free cancellation'
          : 'Non-refundable',
      offerId: offer.id,
      amadeusData: offer,
    };
  }

  // Hotels.com region id: static map first, then FREE suggest API
  private async lookupRegionId(location: string): Promise<string | null> {
    const query = location.trim();
    if (!query) {
      console.warn('⚠️ lookupRegionId called with empty location');
      return null;
    }

    const key = query.toLowerCase();
    const cityToRegionId: Record<string, string> = {
      karachi: '1636475',
      dubai: '11594',
      lahore: '2068',
      islamabad: '555170',
      'new york': '2621',
      london: '2114',
      paris: '2734',
      // US
      'los angeles': '1439028',
      chicago: '1497539',
      miami: '1516192',
      boston: '1401516',
      seattle: '1481165',
      'san francisco': '1493604',
      orlando: '1404711',
      'las vegas': '1504033',
      'san diego': '1483250',
      dallas: '1486134',
      houston: '1410382',
      phoenix: '1469103',
      philadelphia: '1434435',
      atlanta: '1496137',
      denver: '1440421',
      'washington dc': '1467359',
      nashville: '1489624',
      austin: '1496344',
      'san antonio': '1490932',
      'san jose': '1416752',
      // Canada
      toronto: '1636865',
      vancouver: '169712',
      montreal: '169716',
      // Europe
      berlin: '332483',
      rome: '712491',
      barcelona: '444495',
      madrid: '457987',
      amsterdam: '934558',
      vienna: '39254',
      istanbul: '1341107',
      prague: '1634829',
      budapest: '643376',
      warsaw: '1036999',
      krakow: '1053546',
      brussels: '59474',
      edinburgh: '554344',
      dublin: '691513',
      manchester: '544578',
      stockholm: '189852',
      oslo: '939302',
      athens: '593632',
      helsinki: '178261',
      // Asia / Pacific
      tokyo: '726784',
      osaka: '728660',
      kyoto: '725674',
      bangkok: '1313946',
      singapore: '1655844',
      seoul: '759818',
      sydney: '26633',
      melbourne: '1633621',
      brisbane: '179993',
      auckland: '950540',
      // Europe (more)
      lisbon: '1063515',
      milan: '712492',
      florence: '1635832',
      naples: '711455',
      lyon: '501534',
      marseille: '510502',
      nice: '494528',
      cologne: '376094',
      düsseldorf: '383887',
      stuttgart: '328521',
      zurich: '172809',
      geneva: '173674',
      valencia: '465941',
      porto: '1063514',
      malta: '595192',
      copenhagen: '1704893',
      reykjavik: '939303',
      // US (more)
      minneapolis: '1410652',
      portland: '1477661',
      tampa: '1401402',
      'new orleans': '1456744',
      charlotte: '1407168',
      pittsburgh: '1474927',
      indianapolis: '1432803',
      'st louis': '1426966',
      'kansas city': '1406838',
      detroit: '1538574',
      sacramento: '1483249',
      raleigh: '1489625',
      columbus: '1432822',
      cincinnati: '1432804',
      baltimore: '1401515',
      milwaukee: '1497540',
      cleveland: '1432812',
      // Canada (more)
      calgary: '169003',
      ottawa: '169714',
      'quebec city': '169995',
      'québec city': '169995',
      // Latin America & Caribbean
      'mexico city': '830421',
      'buenos aires': '14534',
      lima: '968225',
      bogota: '1634154',
      'rio de janeiro': '146100',
      santiago: '174821',
      'panama city': '954845',
      'san juan': '1634157',
      havana: '1634158',
      // Middle East & Africa
      'abu dhabi': '1634727',
      doha: '1635763',
      cairo: '1634358',
      'cape town': '1613001',
      johannesburg: '1644399',
      marrakech: '494529',
      telaviv: '593633',
      // asia (more)
      'hong kong': '605659',
      hongkong: '605659',
      'new delhi': '675357',
      mumbai: '1640701',
      'kuala lumpur': '1656545',
      manila: '1004070',
      jakarta: '1313948',
      taipei: '728661',
      hanoi: '1313949',
      'ho chi minh city': '1313950',
    };

    let staticRegionId: string | null = null;

    if (cityToRegionId[key]) {
      staticRegionId = cityToRegionId[key];
      console.log(
        '✅ lookupRegionId found static regionId mapping (exact):',
        staticRegionId,
        'for location:',
        query,
      );
    } else {
      // strip country / punctuation and retry
      const normalizedKey = key
        .split(',')[0]
        .replace(/[^a-z\s]/g, '')
        .trim();
      if (normalizedKey && cityToRegionId[normalizedKey]) {
        staticRegionId = cityToRegionId[normalizedKey];
        console.log(
          '✅ lookupRegionId found static regionId mapping (normalized):',
          staticRegionId,
          'for location:',
          query,
          'normalized to:',
          normalizedKey,
        );
      }
    }

    // no RapidAPI key → static map only
    if (!this.rapidApiKey) {
      if (!staticRegionId) {
        console.warn(
          '⚠️ RAPIDAPI_KEY missing – cannot look up regionId via Hotels.com FREE suggest API.',
        );
        return null;
      }
      console.warn(
        '⚠️ RAPIDAPI_KEY missing – using static regionId mapping only for location:',
        query,
        'regionId:',
        staticRegionId,
      );
      return staticRegionId;
    }

    const host = this.hotelsSuggestHost || 'hotels-com-free.p.rapidapi.com';
    const url = new URL(`https://${host}/suggest/v1.7/json`);
    url.searchParams.set('query', query);
    url.searchParams.set('locale', 'en_US');

    const callSuggestOnce = async (): Promise<any | null> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      try {
        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'x-rapidapi-key': this.rapidApiKey,
            'x-rapidapi-host': host,
          },
          signal: (controller as any).signal,
        }).finally(() => clearTimeout(timeout));

        if (!res.ok) {
          const text = await res.text();
          console.error(
            '❌ Hotels.com FREE suggest error:',
            res.status,
            text.slice(0, 500),
          );
          return null;
        }

        return (await res.json()) as any;
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          console.error(
            '❌ lookupRegionId: Hotels.com FREE suggest API request timed out',
          );
        } else {
          console.error(
            '❌ lookupRegionId: Hotels.com FREE suggest API request failed:',
            error,
          );
        }
        return null;
      }
    };

    try {
      console.log(
        '🔎 Looking up regionId via Hotels.com FREE suggest API for location:',
        query,
      );

      // one retry on timeout / error
      let data: any = await callSuggestOnce();
      if (!data) {
        console.warn(
          '⚠️ FIRST Hotels.com FREE suggest attempt failed, retrying once...',
        );
        data = await callSuggestOnce();
        if (!data) {
          console.error(
            '❌ lookupRegionId: Hotels.com FREE suggest failed twice, falling back.',
          );
          if (staticRegionId) {
            console.warn(
              '⚠️ Falling back to static regionId mapping after FREE suggest failure for location:',
              query,
              'regionId:',
              staticRegionId,
            );
            return staticRegionId;
          }
          return null;
        }
      }

      // suggest payloads vary — try common array keys
      const suggestions: any[] =
        (Array.isArray(data?.sr) && data.sr) ||
        (Array.isArray(data?.data) && data.data) ||
        (Array.isArray(data) && data) ||
        [];

      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        console.warn(
          '⚠️ Hotels.com FREE suggest returned no suggestions for location:',
          query,
        );
        return null;
      }

      const normalizedQuery = query.toLowerCase().trim();

      const pickRegionId = (item: any): string | null => {
        if (!item || typeof item !== 'object') return null;
        const numeric = (v: any) =>
          typeof v === 'string' || typeof v === 'number'
            ? /^\d+$/.test(String(v))
            : false;

        // prefer numeric gaiaId / regionId
        if (item.gaiaId && numeric(item.gaiaId)) return String(item.gaiaId);
        if (item.regionId && numeric(item.regionId))
          return String(item.regionId);
        if (item.id && numeric(item.id)) return String(item.id);

        return null;
      };

      const getDisplayName = (item: any): string => {
        return (
          item?.regionNames?.displayName ||
          item?.regionNames?.fullName ||
          item?.name ||
          ''
        ).toString();
      };

      const isCityType = (item: any): boolean => {
        const type = (item?.type || item?.group || '').toString().toUpperCase();
        return type.includes('CITY');
      };

      // prefer CITY match → any CITY → first result
      let chosen =
        suggestions.find(
          (s: any) =>
            isCityType(s) &&
            getDisplayName(s).toLowerCase().includes(normalizedQuery),
        ) ||
        suggestions.find((s: any) => isCityType(s)) ||
        suggestions[0];

      const dynamicRegionId = pickRegionId(chosen);

      if (!dynamicRegionId) {
        console.warn(
          '⚠️ Could not extract regionId from Hotels.com FREE suggest response for location:',
          query,
        );
        if (staticRegionId) {
          console.warn(
            '⚠️ Falling back to static regionId mapping for location:',
            query,
            'regionId:',
            staticRegionId,
          );
          return staticRegionId;
        }
        return null;
      }

      console.log(
        '✅ lookupRegionId resolved regionId via Hotels.com FREE suggest:',
        dynamicRegionId,
        'for location:',
        query,
      );

      // Lahore static id is more reliable than suggest
      const preferStaticKeys = new Set<string>(['lahore']);
      if (staticRegionId && preferStaticKeys.has(key)) {
        console.log(
          'ℹ️ lookupRegionId: using static regionId override for location:',
          query,
          'static:',
          staticRegionId,
          'dynamic:',
          dynamicRegionId,
        );
        return staticRegionId;
      }

      return dynamicRegionId;
    } catch (error: any) {
      console.error(
        '❌ lookupRegionId: Unexpected error while handling FREE suggest response:',
        error,
      );
      return null;
    }
  }

  // Hotels.com Provider search → UI hotel shape
  private async searchHotelsViaHotelsCom(params: {
    regionId: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    rooms: number;
    locationName?: string;
  }): Promise<any[]> {
    if (!this.rapidApiKey) {
      throw new HttpException(
        'Hotels.com Provider is not configured (missing RAPIDAPI_KEY).',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const base = `https://${this.hotelsApiHost}`;
    const url = new URL(`${base}/v3/hotels/search`);
    url.searchParams.set('region_id', params.regionId);
    url.searchParams.set('checkin_date', params.checkIn);
    url.searchParams.set('checkout_date', params.checkOut);
    url.searchParams.set('adults_number', String(params.adults));
    url.searchParams.set('locale', 'en_US');
    url.searchParams.set('domain', 'US');
    url.searchParams.set('sort_order', 'REVIEW'); // required by API

    console.log(
      '🏨 Calling Hotels.com Provider search with URL:',
      url.toString(),
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-rapidapi-key': this.rapidApiKey,
        'x-rapidapi-host': this.hotelsApiHost,
      },
      signal: (controller as any).signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      const text = await res.text();
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }

      console.error('❌ Hotels.com search error:', {
        status: res.status,
        body: body || text,
      });

      // Provider sometimes returns a useless 424 — treat as empty
      if (
        res.status === 424 &&
        body &&
        typeof body === 'object' &&
        body.detail === 'General client error, try again'
      ) {
        console.warn(
          '⚠️ Hotels.com Provider returned generic 424 client error. Treating as empty result set.',
        );
        return [];
      }

      throw new HttpException(
        (body && (body.detail || body.message)) ||
          text ||
          'Hotels.com Provider search failed',
        res.status as any,
      );
    }

    const data = await res.json();
    const rawHotels =
      data?.data?.hotels ||
      data?.data?.properties ||
      data?.data?.results ||
      data?.data ||
      data?.hotels ||
      data?.results ||
      (Array.isArray(data) ? data : []);

    if (!Array.isArray(rawHotels) || rawHotels.length === 0) {
      console.warn(
        '⚠️ Hotels.com Provider returned no hotels. Keys:',
        Object.keys(data || {}),
      );
      return [];
    }

    const mapped = rawHotels.map((h: any, index: number) =>
      this.transformHotelsComHotel(h, index, params),
    );

    const requestedCity = params.locationName?.toLowerCase().trim();
    if (requestedCity) {
      const filtered = mapped.filter((h: any) =>
        (h.location || '').toLowerCase().includes(requestedCity),
      );
      if (filtered.length === 0) {
        console.warn(
          '⚠️ Hotels.com Provider returned hotels, but none matched requested city:',
          requestedCity,
        );
      } else {
        console.log(
          `✅ Filtered Hotels.com Provider results to ${filtered.length} hotels matching requested city:`,
          requestedCity,
        );
        return filtered;
      }
    }

    return mapped;
  }

  // Booking.com dest_id + search_type for a city query
  private async resolveBookingDestination(city: string): Promise<{
    destId: string;
    searchType: string;
  } | null> {
    const query = city.trim();
    if (!query) {
      console.warn('⚠️ resolveBookingDestination called with empty city');
      return null;
    }

    const key = query.toLowerCase();
    if (this.bookingDestCache[key]) {
      return this.bookingDestCache[key];
    }

    if (!this.rapidApiKey) {
      console.warn(
        '⚠️ resolveBookingDestination: RAPIDAPI_KEY missing – cannot resolve Booking.com dest_id.',
      );
      return null;
    }

    const url = new URL(
      `https://${this.bookingApiHost}/api/v1/hotels/searchDestination`,
    );
    url.searchParams.set('query', query);

    console.log(
      '🔎 Resolving Booking.com destination via searchDestination for city:',
      query,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-rapidapi-key': this.rapidApiKey,
          'x-rapidapi-host': this.bookingApiHost,
        },
        signal: (controller as any).signal,
      }).finally(() => clearTimeout(timeout));

      if (!res.ok) {
        const text = await res.text();
        let body: any;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        console.error('❌ Booking.com searchDestination error:', {
          status: res.status,
          body: body || text,
        });
        return null;
      }

      const data = await res.json();
      const items: any[] = Array.isArray(data?.data) ? data.data : [];

      if (!Array.isArray(items) || items.length === 0) {
        console.warn(
          '⚠️ Booking.com searchDestination returned no destinations for city:',
          query,
        );
        return null;
      }

      const normalizedQuery = key;
      const isCityLike = (item: any): boolean => {
        const t = (
          item?.search_type ||
          item?.dest_type ||
          item?.type ||
          ''
        )
          .toString()
          .toLowerCase();
        return t.includes('city') || t === 'ci';
      };

      const labelOf = (item: any): string =>
        (
          item?.label ||
          item?.city_name ||
          item?.name ||
          ''
        )
          .toString()
          .toLowerCase();

      // prefer city-type matches, else first result
      const cityItems = items.filter(isCityLike);
      let chosen =
        cityItems.find((i) => labelOf(i).includes(normalizedQuery)) ||
        cityItems[0] ||
        items[0];

      const destIdRaw = chosen?.dest_id;
      if (!destIdRaw) {
        console.warn(
          '⚠️ Booking.com searchDestination: chosen item missing dest_id for city:',
          query,
        );
        return null;
      }

      const destId = String(destIdRaw);
      const searchType = (
        chosen?.search_type ||
        chosen?.dest_type ||
        'CITY'
      )
        .toString()
        .toUpperCase();

      const resolved = { destId, searchType };
      this.bookingDestCache[key] = resolved;

      console.log(
        '✅ resolveBookingDestination resolved Booking.com dest_id:',
        resolved,
        'for city:',
        query,
      );

      return resolved;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        console.error(
          '❌ resolveBookingDestination: Booking.com searchDestination request timed out for city:',
          query,
        );
      } else {
        console.error(
          '❌ resolveBookingDestination: Booking.com searchDestination failed for city:',
          query,
          error,
        );
      }
      return null;
    }
  }

  // Booking.com hotel search → UI shape
  private async searchHotelsViaBookingCom(params: {
    city: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    rooms: number;
  }): Promise<any[]> {
    if (!this.rapidApiKey) {
      throw new HttpException(
        'Booking.com search is not configured (missing RAPIDAPI_KEY).',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const destInfo = await this.resolveBookingDestination(params.city);
    if (!destInfo) {
      console.warn(
        '⚠️ Booking.com search: could not resolve destination for city:',
        params.city,
      );
      return [];
    }

    const url = new URL(
      `https://${this.bookingApiHost}/api/v1/hotels/searchHotels`,
    );
    url.searchParams.set('dest_id', destInfo.destId);
    url.searchParams.set('search_type', destInfo.searchType || 'CITY');
    url.searchParams.set('arrival_date', params.checkIn);
    url.searchParams.set('departure_date', params.checkOut);
    url.searchParams.set('adults', String(params.adults));
    if (params.children && params.children > 0) {
      // Booking wants child ages — we don't collect them, default to 8
      const ages = Array.from({ length: params.children }, () => '8').join(',');
      url.searchParams.set('children_age', ages);
    }
    url.searchParams.set('room_qty', String(params.rooms));
    url.searchParams.set('page_number', '1');
    url.searchParams.set('units', 'metric');
    url.searchParams.set('temperature_unit', 'c');
    url.searchParams.set('languagecode', 'en-us');
    url.searchParams.set('currency_code', 'AED');
    url.searchParams.set('location', 'US');

    console.log(
      '🏨 Calling Booking.com (booking-com15) search with URL:',
      url.toString(),
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-rapidapi-key': this.rapidApiKey,
        'x-rapidapi-host': this.bookingApiHost,
      },
      signal: (controller as any).signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      const text = await res.text();
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }

      console.error('❌ Booking.com search error:', {
        status: res.status,
        body: body || text,
      });

      throw new HttpException(
        (body && (body.detail || body.message)) ||
          text ||
          'Booking.com search failed',
        res.status as any,
      );
    }

    const data = await res.json();
    const rawHotels: any[] = data?.data?.hotels || [];

    if (!Array.isArray(rawHotels) || rawHotels.length === 0) {
      console.warn(
        '⚠️ Booking.com search returned no hotels for city:',
        params.city,
      );
      return [];
    }

    const mapped = rawHotels.map((h: any, index: number) =>
      this.transformBookingComHotel(h, index, params),
    );

    console.log(
      `✅ Booking.com search returned ${mapped.length} hotels for city:`,
      params.city,
    );
    return mapped;
  }

  // Booking.com hotel → shared UI shape
  private transformBookingComHotel(
    bookingHotel: any,
    index: number,
    search: {
      checkIn: string;
      checkOut: string;
      adults: number;
      children: number;
      rooms: number;
    },
  ) {
    const prop = bookingHotel?.property || {};
    const id = prop.id ?? bookingHotel?.hotel_id ?? `hotel-${index}`;
    const name = prop.name || `Hotel ${index + 1}`;
    const cityName = prop.wishlistName || '';

    const thumbnailUrl =
      (Array.isArray(prop.photoUrls) && prop.photoUrls[0]) ||
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=300&fit=crop';

    const grossPrice = prop.priceBreakdown?.grossPrice?.value;
    const priceCurrency = prop.priceBreakdown?.grossPrice?.currency;

    const pseudoHotel = {
      id,
      name,
      address: {
        city: cityName,
        line1: '',
      },
      city: cityName,
      guestReviews: {
        rating: prop.reviewScore ?? 0,
        total: prop.reviewCount ?? 0,
      },
      reviewScore: prop.reviewScore ?? 0,
      reviewCount: prop.reviewCount ?? 0,
      thumbnailUrl,
      image: { url: thumbnailUrl },
      heroImageUrl: thumbnailUrl,
      price: {
        current: typeof grossPrice === 'number' ? grossPrice : undefined,
        currency: priceCurrency,
      },
      freeCancellation: false,
      shortDescription: bookingHotel.accessibilityLabel,
      starRating: prop.propertyClass ?? prop.accuratePropertyClass ?? 0,
    };

    return this.transformHotelsComHotel(pseudoHotel, index, {
      checkIn: search.checkIn,
      checkOut: search.checkOut,
      adults: search.adults,
      children: search.children,
      rooms: search.rooms,
    });
  }

  // Hotels.com / pseudo-hotel → UI Hotel shape
  private transformHotelsComHotel(
    hotel: any,
    index: number,
    search: {
      checkIn: string;
      checkOut: string;
      adults: number;
      children: number;
      rooms: number;
    },
  ) {
    const id = hotel?.id || hotel?.hotelId || hotel?.propertyId || `hotel-${index}`;
    const name = hotel?.name || hotel?.title || `Hotel ${index + 1}`;

    const cityName =
      hotel?.address?.city ||
      hotel?.city ||
      hotel?.location?.city ||
      hotel?.localizedName ||
      '';

    const addressLine =
      hotel?.address?.line1 ||
      hotel?.address?.street ||
      hotel?.location?.address ||
      hotel?.neighbourhood ||
      '';

    const location =
      [cityName, addressLine].filter(Boolean).join(' - ') ||
      cityName ||
      addressLine ||
      '';

    // guestReviews.rating is sometimes an object, not a number
    const guestReviewsRating = hotel?.guestReviews?.rating;
    let guestRatingValue: number | string | undefined;
    if (
      guestReviewsRating &&
      typeof guestReviewsRating === 'object' &&
      'rating' in guestReviewsRating
    ) {
      guestRatingValue = (guestReviewsRating as any).rating;
    } else {
      guestRatingValue = guestReviewsRating;
    }
    const guestRating =
      guestRatingValue ??
      hotel?.guestRating ??
      hotel?.reviewScore ??
      0;

    const starRating =
      typeof hotel?.starRating === 'number'
        ? hotel.starRating
        : typeof hotel?.starRating === 'string'
          ? parseFloat(hotel.starRating)
          : undefined;

    const reviewCount =
      hotel?.guestReviews?.total ||
      hotel?.reviewCount ||
      hotel?.numberOfReviews ||
      0;

    const image =
      hotel?.thumbnailUrl ||
      hotel?.image?.url ||
      hotel?.heroImageUrl ||
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=300&fit=crop';

    const nightlyPrice =
      hotel?.ratePlan?.price?.exactCurrent ||
      hotel?.price?.current ||
      hotel?.price?.lead?.amount ||
      hotel?.price;

    let price =
      typeof nightlyPrice === 'number'
        ? nightlyPrice
        : typeof nightlyPrice === 'string'
          ? parseFloat(nightlyPrice.replace(/[^0-9.]/g, '')) || 0
          : 0;

    // dig nested price objects when lead amount is missing
    if (!price && hotel?.price && typeof hotel.price === 'object') {
      const candidateNumbers: number[] = [];
      Object.values(hotel.price).forEach((v: any) => {
        if (typeof v === 'number') candidateNumbers.push(v);
        if (typeof v === 'string') {
          const num = parseFloat(v.replace(/[^0-9.]/g, ''));
          if (!isNaN(num) && num > 0) candidateNumbers.push(num);
        }
        if (v && typeof v === 'object') {
          Object.values(v).forEach((vv: any) => {
            if (typeof vv === 'number') candidateNumbers.push(vv);
            if (typeof vv === 'string') {
              const num = parseFloat(vv.replace(/[^0-9.]/g, ''));
              if (!isNaN(num) && num > 0) candidateNumbers.push(num);
            }
          });
        }
      });
      if (candidateNumbers.length > 0) {
        price = Math.min(...candidateNumbers);
      }
    }

    if (typeof price === 'number' && !Number.isNaN(price)) {
      price = Math.floor(price);
    }

    const amenities: string[] =
      hotel?.amenities?.map?.((a: any) => a?.name || a) ||
      hotel?.propertyAmenities?.map?.((a: any) => a?.name || a) ||
      [];

    const cancellation =
      hotel?.ratePlan?.freeCancellation || hotel?.freeCancellation
        ? 'Free cancellation'
        : 'Non-refundable';

    const roomId = hotel?.roomTypeId || `${id}-room-1`;

    const room = {
      id: roomId,
      name: hotel?.ratePlan?.roomName || 'Standard room',
      type: 'Room',
      price,
      originalPrice: undefined,
      maxOccupancy: {
        adults: search.adults || 1,
        children: search.children || 0,
        total: (search.adults || 1) + (search.children || 0),
      },
      bedTypes: [],
      amenities,
      size: undefined,
      cancellationPolicy:
        cancellation === 'Free cancellation'
          ? 'Free cancellation'
          : 'Non-refundable',
      offerId: roomId,
    };

    return {
      id,
      name,
      location: cityName || location,
      address: addressLine,
      distance: undefined,
      price,
      originalPrice: undefined,
      pricePerNight: true,
      rating: guestRating || starRating || 4,
      reviewCount,
      image,
      images: [image],
      amenities,
      stars: starRating,
      cancellation,
      rooms: [room],
      description: hotel?.shortDescription || hotel?.description || undefined,
    };
  }
}