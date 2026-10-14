import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HotelsService } from './hotels.service';

@Controller('travel/hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Get('featured')
  async getFeaturedHotels() {
    return this.hotelsService.getFeaturedHotels();
  }

  @Post('featured')
  async addFeaturedHotel(
    @Body()
    body: {
      amadeusHotelId: string;
      name: string;
      cityCode: string;
      cityName?: string;
      imageUrl?: string;
      price?: string;
    },
  ) {
    if (!body.amadeusHotelId || !body.name || !body.cityCode) {
      throw new HttpException(
        'amadeusHotelId, name, and cityCode are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.hotelsService.addFeaturedHotel(body);
  }

  @Delete('featured/:id')
  async removeFeaturedHotel(@Param('id') id: string) {
    if (!id) {
      throw new HttpException('id is required', HttpStatus.BAD_REQUEST);
    }
    return this.hotelsService.removeFeaturedHotel(id);
  }

  @Get('test')
  async testEndpoint() {
    return {
      success: true,
      message: 'Hotels endpoint is working!',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('list')
  async getHotelsList(@Query('location') location?: string) {
    console.log('🏨 Hotel list request received:', { location });

    if (!location) {
      throw new HttpException(
        'Missing required parameter: location',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const hotels = await this.hotelsService.getHotelsList(location);
      return hotels;
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to get hotels list',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  async searchHotels(
    @Query('location') location?: string,
    @Query('checkIn') checkIn?: string,
    @Query('checkOut') checkOut?: string,
    @Query('adults') adults?: string,
    @Query('children') children?: string,
    @Query('rooms') rooms?: string,
  ) {
    console.log('🏨 Hotel search request received:', {
      location,
      checkIn,
      checkOut,
      adults,
      children,
      rooms,
    });

    if (!location) {
      throw new HttpException(
        'Missing required parameter: location',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const hotels = await this.hotelsService.searchHotels({
        location,
        checkIn,
        checkOut,
        adults: adults ? parseInt(adults) : 1,
        children: children ? parseInt(children) : 0,
        rooms: rooms ? parseInt(rooms) : 1,
      });
      return hotels;
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to search hotels',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':hotelId/offers')
  async getHotelOffers(
    @Param('hotelId') hotelId: string,
    @Query('checkIn') checkIn?: string,
    @Query('checkOut') checkOut?: string,
    @Query('adults') adults?: string,
    @Query('children') children?: string,
    @Query('rooms') rooms?: string,
  ) {
    if (!hotelId || !checkIn || !checkOut) {
      throw new HttpException(
        'Missing required parameters: hotelId, checkIn, checkOut',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const offers = await this.hotelsService.getHotelOffers(hotelId, {
        checkIn,
        checkOut,
        adults: adults ? parseInt(adults) : 1,
        children: children ? parseInt(children) : 0,
        rooms: rooms ? parseInt(rooms) : 1,
      });

      return offers;
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to get hotel offers',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
