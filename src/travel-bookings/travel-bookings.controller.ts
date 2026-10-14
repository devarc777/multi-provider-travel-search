import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { TravelBookingsService } from './travel-bookings.service';
import { FlightsService } from '../flights/flights.service';
import { HotelsService } from '../hotels/hotels.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('travel/bookings')
export class TravelBookingsController {
  constructor(
    private readonly travelBookingsService: TravelBookingsService,
    private readonly flightsService: FlightsService,
    private readonly hotelsService: HotelsService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async createTravelBooking(
    @Body() body: any,
    @Req() req: any,
    @Res() res: Response,
  ) {
    console.log(
      '\n\n🚨🚨🚨 ==================== NEW BOOKING REQUEST ====================',
    );
    console.log('✈️ Creating travel booking:', body);
    console.log('👤 User ID:', req.user?.id);
    console.log(
      '🚨🚨🚨 ============================================================\n',
    );

    const { type, itemData, price, fullName, email } = body;

    if (!type || !itemData || !price || !fullName || !email) {
      throw new HttpException(
        'Missing required fields',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!['flight', 'hotel', 'car'].includes(type)) {
      throw new HttpException('Invalid booking type', HttpStatus.BAD_REQUEST);
    }

    try {
      const amadeusOrderId: string | null = null;
      const amadeusBookingReference: string | null = null;
      const amadeusTickets: any[] | null = null;
      const amadeusTicketingStatus: string | null = null;
      const amadeusHotelBookingId: string | null = null;
      const amadeusHotelConfirmationNumber: string | null = null;

      // flights → 302 redirect to Kiwi (no on-site Amadeus book)
      if (type === 'flight' && itemData.flight?.amadeusData) {
        console.log('🔗 Processing flight booking redirect to Kiwi.com...');

        const flightOffer = itemData.flight.amadeusData;

        try {
          const flightParams = this.extractFlightParams(flightOffer);
          const kiwiLink = this.buildKiwiDeepLink(flightParams);

          const logData = {
            timestamp: new Date().toISOString(),
            userId: req.user?.id,
            flightSummary: {
              origin: flightParams.origin,
              destination: flightParams.destination,
              date: flightParams.date,
              adults: flightParams.adults,
            },
            kiwiLink: kiwiLink,
          };
          console.log('🔗 Redirecting to Kiwi.com:', logData);

          return res.redirect(302, kiwiLink);
        } catch (error: any) {
          console.error(
            '❌ Failed to build Kiwi deep link, using fallback:',
            error,
          );

          try {
            const fallbackParams = this.extractFlightParams(flightOffer, true);
            const fallbackLink = this.buildKiwiFallbackLink(fallbackParams);

            console.log('🔗 Using fallback Kiwi search page:', fallbackLink);
            return res.redirect(302, fallbackLink);
          } catch (fallbackError: any) {
            console.error(
              '❌ Fallback link generation also failed:',
              fallbackError,
            );
            const lastResortLink = this.buildKiwiFallbackLink({
              origin: '',
              destination: '',
              date: '',
              adults: 1,
            });
            return res.redirect(302, lastResortLink);
          }
        }
      } else if (type === 'flight') {
        throw new HttpException(
          'Flight booking requires Amadeus data. Please search for flights again and select a bookable flight.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // hotels → 302 redirect to Booking.com
      if (type === 'hotel' && itemData.hotel?.amadeusData) {
        console.log('🔗 Processing hotel booking redirect to Booking.com...');

        const hotelData = itemData.hotel;
        const hotelAmadeusData = hotelData.amadeusData;

        try {
          const hotelParams = this.extractHotelParams(
            hotelData,
            hotelAmadeusData,
            itemData,
          );
          const bookingLink = this.buildBookingComDeepLink(hotelParams);

          const logData = {
            timestamp: new Date().toISOString(),
            userId: req.user?.id,
            hotelSummary: {
              location: hotelParams.location,
              checkIn: hotelParams.checkIn,
              checkOut: hotelParams.checkOut,
              adults: hotelParams.adults,
              children: hotelParams.children,
              rooms: hotelParams.rooms,
            },
            bookingLink: bookingLink,
          };
          console.log('🔗 Redirecting to Booking.com:', logData);

          return res.redirect(302, bookingLink);
        } catch (error: any) {
          console.error(
            '❌ Failed to build Booking.com deep link, using fallback:',
            error,
          );

          try {
            const fallbackParams = this.extractHotelParams(
              hotelData,
              hotelAmadeusData,
              itemData,
              true,
            );
            const fallbackLink =
              this.buildBookingComFallbackLink(fallbackParams);

            console.log(
              '🔗 Using fallback Booking.com search page:',
              fallbackLink,
            );
            return res.redirect(302, fallbackLink);
          } catch (fallbackError: any) {
            console.error(
              '❌ Fallback link generation also failed:',
              fallbackError,
            );
            return res.redirect(302, 'https://www.booking.com');
          }
        }
      } else if (type === 'hotel') {
        throw new HttpException(
          'Hotel booking requires Amadeus data. Please search for hotels again and select a bookable hotel.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // car / other types: persist booking row
      const bookingData = {
        ...itemData,
        amadeusOrderId,
        amadeusBookingReference,
        amadeusTickets,
        amadeusTicketingStatus,
        amadeusHotelBookingId,
        amadeusHotelConfirmationNumber,
      };

      const booking = await this.travelBookingsService.createTravelBooking(
        req.user.id,
        {
          type,
          itemData: bookingData,
          price,
          fullName,
          email,
        },
      );

      console.log('✅ Travel booking created:', booking.id);
      return res.json({
        ...booking,
        amadeusOrderId,
        amadeusBookingReference,
        amadeusTickets,
        amadeusTicketingStatus,
        isTicketed: amadeusTicketingStatus === 'TICKETED',
      });
    } catch (error: any) {
      console.error('❌ Failed to create travel booking:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Error stack:', error.stack);

      if (error.code === 'P2002') {
        throw new HttpException(
          'A booking with this information already exists',
          HttpStatus.CONFLICT,
        );
      } else if (
        error.message?.includes('travelBookingItem') ||
        error.message?.includes('Unknown arg')
      ) {
        throw new HttpException(
          'Database model error. Please restart the server after running: npx prisma generate',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      throw new HttpException(
        error.message ||
          'Failed to create travel booking. Please check server logs.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async getUserTravelBookings(
    @Req() req: any,
    @Query('status') status?: string,
  ) {
    console.log(
      '✈️ Fetching travel bookings for user:',
      req.user?.id,
      'status:',
      status,
    );

    try {
      const bookings = await this.travelBookingsService.getUserTravelBookings(
        req.user.id,
        status,
      );
      return bookings;
    } catch (error) {
      console.error('❌ Failed to fetch travel bookings:', error);
      throw new HttpException(
        'Failed to fetch travel bookings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async updateTravelBookingStatus(
    @Param('id') id: string,
    @Body() body: { status: string; paymentIntentId?: string },
    @Req() req: any,
  ) {
    console.log('✈️ Updating travel booking status:', {
      bookingId: id,
      status: body.status,
      userId: req.user?.id,
      hasPaymentIntentId: !!body.paymentIntentId,
    });

    if (!body.status) {
      throw new HttpException('Status is required', HttpStatus.BAD_REQUEST);
    }

    if (body.status === 'CONFIRMED') {
      if (!body.paymentIntentId) {
        console.error(
          '❌ CRITICAL: Attempt to confirm booking without paymentIntentId',
        );
        throw new HttpException(
          'paymentIntentId is REQUIRED when confirming booking. Payment must be processed through Stripe.',
          HttpStatus.BAD_REQUEST,
        );
      }
      console.log(
        '🔒 STRIPE PAYMENT REQUIRED - Verifying payment before confirming booking',
      );
    }

    try {
      const booking =
        await this.travelBookingsService.updateTravelBookingStatus(
          req.user.id,
          id,
          body.status,
          body.paymentIntentId,
        );
      console.log('✅ Travel booking status updated successfully:', booking.id);
      return booking;
    } catch (error: any) {
      console.error('❌ Failed to update travel booking status:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to update travel booking status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteTravelBooking(@Param('id') id: string, @Req() req: any) {
    console.log('✈️ Deleting travel booking:', id, 'for user:', req.user?.id);

    try {
      await this.travelBookingsService.deleteTravelBooking(req.user.id, id);
      return { success: true };
    } catch (error) {
      console.error('❌ Failed to delete travel booking:', error);
      throw new HttpException(
        'Failed to delete travel booking',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private extractFlightParams(
    flightOffer: any,
    allowPartial: boolean = false,
  ): {
    origin: string;
    destination: string;
    date: string;
    adults: number;
  } {
    try {
      const itinerary = flightOffer?.itineraries?.[0];
      if (!itinerary && !allowPartial) {
        throw new Error('Invalid flight offer: missing itineraries');
      }

      const segments = itinerary?.segments;
      if (!segments || segments.length === 0) {
        if (!allowPartial) {
          throw new Error('Invalid flight offer: missing segments');
        }
        return {
          origin: '',
          destination: '',
          date: '',
          adults: 1,
        };
      }

      const firstSegment = segments[0];
      const lastSegment = segments[segments.length - 1];

      if (!firstSegment || !lastSegment) {
        if (!allowPartial) {
          throw new Error('Invalid flight offer: missing segment data');
        }
        return {
          origin: '',
          destination: '',
          date: '',
          adults: 1,
        };
      }

      const origin = firstSegment.departure?.iataCode;
      const destination = lastSegment.arrival?.iataCode;

      if ((!origin || !destination) && !allowPartial) {
        throw new Error(
          'Invalid flight offer: missing origin or destination codes',
        );
      }

      const departureDateTime = firstSegment.departure?.at;
      if (!departureDateTime && !allowPartial) {
        throw new Error('Invalid flight offer: missing departure date');
      }

      const date = departureDateTime ? departureDateTime.split('T')[0] : '';

      let adults = 1;
      if (
        flightOffer.travelerPricings &&
        flightOffer.travelerPricings.length > 0
      ) {
        adults = flightOffer.travelerPricings.length;
      } else if (flightOffer.numberOfBookableSeats) {
        adults = flightOffer.numberOfBookableSeats;
      }

      return {
        origin: origin || '',
        destination: destination || '',
        date: date || '',
        adults: adults || 1,
      };
    } catch (error: any) {
      if (allowPartial) {
        return {
          origin: '',
          destination: '',
          date: '',
          adults: 1,
        };
      }
      throw error;
    }
  }

  private buildKiwiDeepLink(params: {
    origin: string;
    destination: string;
    date: string;
    adults: number;
  }): string {
    const baseUrl = 'https://www.kiwi.com/deep';
    const affiliateId = '';

    if (!params.origin || !params.destination || !params.date) {
      throw new Error('Missing required parameters for Kiwi deep link');
    }

    const queryParams = new URLSearchParams({
      from: params.origin.toUpperCase(),
      to: params.destination.toUpperCase(),
      date: params.date,
      adults: params.adults.toString(),
    });

    if (affiliateId) {
      queryParams.append('affilid', affiliateId);
    }

    return `${baseUrl}?${queryParams.toString()}`;
  }

  private buildKiwiFallbackLink(params: {
    origin: string;
    destination: string;
    date: string;
    adults: number;
  }): string {
    const baseUrl = 'https://www.kiwi.com/en/search';
    const affiliateId = '';

    const queryParams = new URLSearchParams();

    if (params.origin) {
      queryParams.append('from', params.origin.toUpperCase());
    }
    if (params.destination) {
      queryParams.append('to', params.destination.toUpperCase());
    }
    if (params.date) {
      queryParams.append('departure', params.date);
    }
    if (params.adults) {
      queryParams.append('adults', params.adults.toString());
    }

    if (affiliateId) {
      queryParams.append('affilid', affiliateId);
    }

    if (queryParams.toString()) {
      return `${baseUrl}?${queryParams.toString()}`;
    } else if (affiliateId) {
      return `${baseUrl}?affilid=${affiliateId}`;
    } else {
      return baseUrl;
    }
  }

  private extractHotelParams(
    hotelData: any,
    hotelAmadeusData: any,
    itemData: any,
    allowPartial: boolean = false,
  ): {
    location: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    rooms: number;
  } {
    try {
      let location = '';

      if (hotelData?.location) {
        location = hotelData.location;
      } else if (hotelData?.address) {
        location = hotelData.address;
      } else if (hotelAmadeusData?.hotel?.hotelId) {
        location = hotelAmadeusData.hotel.hotelId;
      } else if (hotelAmadeusData?.hotel?.name) {
        location = hotelAmadeusData.hotel.name;
      }

      // dates usually live on searchParams
      let checkIn = '';
      let checkOut = '';

      if (itemData?.searchParams?.checkIn) {
        checkIn = itemData.searchParams.checkIn;
      } else if (itemData?.checkIn) {
        checkIn = itemData.checkIn;
      }

      if (itemData?.searchParams?.checkOut) {
        checkOut = itemData.searchParams.checkOut;
      } else if (itemData?.checkOut) {
        checkOut = itemData.checkOut;
      }

      let adults = 1;
      let children = 0;
      let rooms = 1;

      if (itemData?.searchParams?.adults) {
        adults = itemData.searchParams.adults;
      } else if (itemData?.guests && itemData.guests.length > 0) {
        adults = itemData.guests.length;
      } else if (itemData?.adults) {
        adults = itemData.adults;
      } else if (hotelAmadeusData?.guests?.adults) {
        adults = hotelAmadeusData.guests.adults;
      }

      if (itemData?.searchParams?.children) {
        children = itemData.searchParams.children;
      } else if (itemData?.children) {
        children = itemData.children;
      } else if (hotelAmadeusData?.guests?.childAges?.length) {
        children = hotelAmadeusData.guests.childAges.length;
      }

      if (itemData?.searchParams?.rooms) {
        rooms = itemData.searchParams.rooms;
      } else if (itemData?.rooms) {
        rooms = itemData.rooms;
      } else {
        rooms = 1;
      }

      if ((!location || !checkIn || !checkOut) && !allowPartial) {
        throw new Error(
          'Missing required parameters for Booking.com link: location, checkIn, or checkOut',
        );
      }

      return {
        location: location || '',
        checkIn: checkIn || '',
        checkOut: checkOut || '',
        adults: adults || 1,
        children: children || 0,
        rooms: rooms || 1,
      };
    } catch (error: any) {
      if (allowPartial) {
        return {
          location: '',
          checkIn: '',
          checkOut: '',
          adults: 1,
          children: 0,
          rooms: 1,
        };
      }
      throw error;
    }
  }

  private buildBookingComDeepLink(params: {
    location: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    rooms: number;
  }): string {
    const baseUrl = 'https://www.booking.com/searchresults.html';
    const affiliateId = '';

    if (!params.location || !params.checkIn || !params.checkOut) {
      throw new Error(
        'Missing required parameters for Booking.com deep link: location, checkIn, or checkOut',
      );
    }

    const queryParams = new URLSearchParams({
      city: params.location,
      checkin: params.checkIn,
      checkout: params.checkOut,
      adults: params.adults.toString(),
      no_rooms: params.rooms.toString(),
    });

    if (params.children > 0) {
      queryParams.append('children', params.children.toString());
    }

    if (affiliateId) {
      queryParams.append('affiliate_id', affiliateId);
    }

    return `${baseUrl}?${queryParams.toString()}`;
  }

  private buildBookingComFallbackLink(params: {
    location: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    rooms: number;
  }): string {
    const baseUrl = 'https://www.booking.com/searchresults.html';
    const affiliateId = '';

    const queryParams = new URLSearchParams();

    if (params.location) {
      queryParams.append('city', params.location);
    }
    if (params.checkIn) {
      queryParams.append('checkin', params.checkIn);
    }
    if (params.checkOut) {
      queryParams.append('checkout', params.checkOut);
    }
    if (params.adults) {
      queryParams.append('adults', params.adults.toString());
    }
    if (params.children > 0) {
      queryParams.append('children', params.children.toString());
    }
    if (params.rooms) {
      queryParams.append('no_rooms', params.rooms.toString());
    }

    if (affiliateId) {
      queryParams.append('affiliate_id', affiliateId);
    }

    if (queryParams.toString()) {
      return `${baseUrl}?${queryParams.toString()}`;
    } else if (affiliateId) {
      return `${baseUrl}?affiliate_id=${affiliateId}`;
    } else {
      return baseUrl;
    }
  }
}
