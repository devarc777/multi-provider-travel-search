import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripePaymentService } from '../payments/stripe-payment.service';

@Injectable()
export class TravelBookingsService {
  constructor(
    private prisma: PrismaService,
    private stripePaymentService: StripePaymentService,
  ) {}

  async createTravelBooking(
    userId: string,
    data: {
      type: 'flight' | 'hotel' | 'car';
      itemData: any;
      price: string;
      fullName: string;
      email: string;
    },
  ) {
    console.log(
      '✈️ TravelBookingsService: Creating travel booking for user:',
      userId,
    );
    console.log('📋 Booking data:', {
      type: data.type,
      hasFlight: !!data.itemData?.flight,
      price: data.price,
    });

    const normalizedType = data.type.toLowerCase();

    const booking = await this.prisma.travelBookingItem.create({
      data: {
        userId,
        type: normalizedType,
        itemData: data.itemData,
        price: data.price,
        fullName: data.fullName,
        email: data.email,
        status: 'PENDING',
      },
    });

    console.log('✅ Booking created in DB:', {
      id: booking.id,
      type: booking.type,
      status: booking.status,
      hasFlight: !!(booking.itemData as any)?.flight,
    });

    // shape for frontend (data + itemData)
    const result = {
      id: booking.id,
      type: booking.type as 'flight' | 'hotel' | 'car',
      data: booking.itemData as any,
      itemData: booking.itemData as any,
      price: booking.price,
      dateAdded: booking.createdAt.toISOString(),
      status: booking.status,
      customerInfo: {
        fullName: booking.fullName,
        email: booking.email,
      },
    };

    console.log('📤 Returning booking:', {
      id: result.id,
      type: result.type,
      status: result.status,
      hasFlight: !!result.data?.flight,
    });

    return result;
  }

  async getUserTravelBookings(userId: string, status?: string) {
    console.log(
      '✈️ TravelBookingsService: Fetching travel bookings for user:',
      userId,
      'status:',
      status,
    );

    const whereClause: any = { userId };
    if (status) {
      whereClause.status = status;
    }

    const bookings = await this.prisma.travelBookingItem.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    const transformed = bookings.map((booking) => {
      const normalizedType = booking.type.toLowerCase() as
        | 'flight'
        | 'hotel'
        | 'car';

      const result = {
        id: booking.id,
        type: normalizedType,
        data: booking.itemData as any,
        itemData: booking.itemData as any,
        price: booking.price,
        dateAdded: booking.createdAt.toISOString(),
        status: booking.status,
        customerInfo: {
          fullName: booking.fullName,
          email: booking.email,
        },
      };
      console.log('📦 Transformed booking:', {
        id: result.id,
        type: result.type,
        originalType: booking.type,
        hasFlight: !!result.data?.flight,
        status: result.status,
      });
      return result;
    });

    const flightCount = transformed.filter((b) => b.type === 'flight').length;
    console.log(
      `✅ Returning ${transformed.length} bookings (${flightCount} flights)`,
    );
    console.log(
      '📋 All booking types:',
      transformed.map((b) => b.type),
    );
    return transformed;
  }

  async updateTravelBookingStatus(
    userId: string,
    bookingId: string,
    status: string,
    paymentIntentId?: string,
  ) {
    console.log('✈️ TravelBookingsService: Updating travel booking status:', {
      bookingId,
      status,
      userId,
      hasPaymentIntentId: !!paymentIntentId,
    });

    const booking = await this.prisma.travelBookingItem.findUnique({
      where: { id: bookingId },
    });

    if (!booking || booking.userId !== userId) {
      throw new HttpException(
        'Travel booking not found or access denied',
        HttpStatus.NOT_FOUND,
      );
    }

    // CONFIRMED requires a real Stripe paymentIntentId
    if (status === 'CONFIRMED') {
      if (!paymentIntentId) {
        console.error(
          '❌ CRITICAL: Attempt to confirm booking without paymentIntentId',
        );
        throw new HttpException(
          'paymentIntentId is REQUIRED when confirming booking. Payment must be processed through Stripe.',
          HttpStatus.BAD_REQUEST,
        );
      }

      console.log(
        '💰 STRIPE PAYMENT VERIFICATION - Verifying payment before confirming booking...',
      );
      console.log('🔑 Payment Intent ID:', paymentIntentId);
      console.log('📋 Booking Type:', booking.type);
      console.log('💰 Booking Price:', booking.price);

      try {
        if (
          !paymentIntentId ||
          typeof paymentIntentId !== 'string' ||
          !paymentIntentId.startsWith('pi_')
        ) {
          console.error('❌ INVALID PAYMENT INTENT ID:', paymentIntentId);
          throw new HttpException(
            'Invalid payment intent ID. Payment must be processed through Stripe.',
            HttpStatus.BAD_REQUEST,
          );
        }

        const paymentIntent =
          await this.stripePaymentService.getPaymentStatus(paymentIntentId);
        console.log('✅ Payment Intent retrieved from Stripe:', {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
        });

        if (paymentIntent.status !== 'succeeded') {
          console.error(
            '❌ STRIPE PAYMENT FAILED - Status:',
            paymentIntent.status,
          );
          console.error('❌ Payment Intent details:', {
            id: paymentIntent.id,
            status: paymentIntent.status,
            last_payment_error: paymentIntent.last_payment_error,
          });
          console.error(
            '❌ Booking will NOT be confirmed. Payment verification failed.',
          );
          throw new HttpException(
            `Stripe payment not succeeded. Status: ${paymentIntent.status}. Booking cannot be confirmed. Please try again or contact support.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        // amount must match booking + 10% service fee
        const bookingPrice = parseFloat(booking.price);
        if (isNaN(bookingPrice) || bookingPrice <= 0) {
          console.error('❌ INVALID BOOKING PRICE:', booking.price);
          throw new HttpException(
            'Invalid booking price. Cannot verify payment amount.',
            HttpStatus.BAD_REQUEST,
          );
        }

        const serviceFee = Math.round(bookingPrice * 0.1);
        const expectedAmountCents = Math.round(
          (bookingPrice + serviceFee) * 100,
        );

        console.log('💰 Payment Amount Verification:', {
          bookingPrice,
          serviceFee,
          expectedAmountCents,
          receivedAmountCents: paymentIntent.amount,
          currency: paymentIntent.currency,
        });

        if (paymentIntent.amount !== expectedAmountCents) {
          console.error('❌ PAYMENT AMOUNT MISMATCH:', {
            expected: expectedAmountCents,
            received: paymentIntent.amount,
            bookingPrice,
            serviceFee,
            difference: paymentIntent.amount - expectedAmountCents,
          });
          throw new HttpException(
            `Payment amount mismatch. Expected $${(expectedAmountCents / 100).toFixed(2)}, received $${(paymentIntent.amount / 100).toFixed(2)}. Booking cannot be confirmed.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        console.log('✅ STRIPE PAYMENT VERIFIED SUCCESSFULLY');
        console.log('✅ Payment amount verified:', paymentIntent.amount);
        console.log('✅ Payment currency verified:', paymentIntent.currency);
        console.log('✅ Updating booking status to CONFIRMED...');
      } catch (error: any) {
        console.error('❌ STRIPE PAYMENT VERIFICATION FAILED:', error);
        console.error('❌ Error details:', {
          message: error.message,
          status: error.status,
          statusCode: error.statusCode,
          code: error.code,
          type: error.type,
        });

        if (error instanceof HttpException) {
          throw error;
        }

        if (error.type && error.type.startsWith('Stripe')) {
          throw new HttpException(
            `Stripe payment verification failed: ${error.message || 'Unknown Stripe error'}. Please try again or contact support.`,
            HttpStatus.BAD_REQUEST,
          );
        }

        throw new HttpException(
          `Stripe payment verification failed: ${error.message || 'Unknown error'}. Booking cannot be confirmed without valid payment.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const updateData: any = { status };

    if (paymentIntentId && status === 'CONFIRMED') {
      updateData.paymentIntentId = paymentIntentId;
      updateData.paymentStatus = 'COMPLETED';
      updateData.paymentId = paymentIntentId;
      updateData.paymentMethod = 'card';
      console.log('💾 Updating booking with payment information');
    }

    const updatedBooking = await this.prisma.travelBookingItem.update({
      where: { id: bookingId },
      data: updateData,
    });

    console.log('✅ Booking status updated successfully:', {
      bookingId: updatedBooking.id,
      status: updatedBooking.status,
      paymentStatus: updatedBooking.paymentStatus,
    });

    return {
      id: updatedBooking.id,
      type: updatedBooking.type as 'flight' | 'hotel' | 'car',
      data: updatedBooking.itemData as any,
      price: updatedBooking.price,
      dateAdded: updatedBooking.createdAt.toISOString(),
      status: updatedBooking.status,
      customerInfo: {
        fullName: updatedBooking.fullName,
        email: updatedBooking.email,
      },
    };
  }

  async deleteTravelBooking(userId: string, bookingId: string) {
    console.log(
      '✈️ TravelBookingsService: Deleting travel booking:',
      bookingId,
      'for user:',
      userId,
    );

    const booking = await this.prisma.travelBookingItem.findUnique({
      where: { id: bookingId },
    });

    if (!booking || booking.userId !== userId) {
      throw new Error('Travel booking not found or access denied');
    }

    await this.prisma.travelBookingItem.delete({
      where: { id: bookingId },
    });

    return { success: true };
  }
}
