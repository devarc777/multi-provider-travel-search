import { Module } from '@nestjs/common';
import { TravelBookingsController } from './travel-bookings.controller';
import { TravelBookingsService } from './travel-bookings.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PrismaModule, FlightsModule, HotelsModule, PaymentsModule],
  controllers: [TravelBookingsController],
  providers: [TravelBookingsService],
  exports: [TravelBookingsService],
})
export class TravelBookingsModule {}
