"use client";

import { useEffect, useState, useMemo, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Footer } from "../../../components/TrustFooter";
import FlightBookingFlow from "../../../components/FlightBookingFlow";
import HotelBookingFlow from "../../../components/HotelBookingFlow";
import { getGeoLocationLabelOncePerSession } from "../../../lib/utils/geoPrefill";

export interface Flight {
  id: string;
  airline: string;
  flightNumber: string;
  departure: {
    airport: string;
    code: string;
    time: string;
    date: string;
  };
  arrival: {
    airport: string;
    code: string;
    time: string;
    date: string;
  };
  duration: string;
  stops: number;
  price: number;
  originalPrice?: number;
  class: 'Economy' | 'Business' | 'First';
  image?: string;
  rating?: number;
  reviewCount?: number;
  amadeusData?: any;
  searchTimestamp?: string;
}

export interface Room {
  id: string;
  name: string;
  type: string;
  price: number;
  originalPrice?: number;
  maxOccupancy: {
    adults: number;
    children?: number;
    total: number;
  };
  bedTypes: string[];
  amenities: string[];
  size?: string;
  cancellationPolicy: string;
  offerId: string;
  amadeusData?: any;
}

export interface Hotel {
  id: string;
  name: string;
  location: string;
  address?: string;
  distance?: string;
  price: number;
  originalPrice?: number;
  pricePerNight: boolean;
  rating: number;
  reviewCount: number;
  image: string;
  images?: string[];
  amenities: string[];
  stars?: number;
  cancellation?: 'Free cancellation' | 'Non-refundable';
  rooms: Room[];
  description?: string;
}


function resolveApiBaseUrl(): string {
  const env = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
  if (env) return env;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3002';
    const base = window.location.origin.replace(/\/$/, '');
    return `${base}/api`;
  }
  return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3002';
}

const API_BASE = resolveApiBaseUrl();
console.log('🌐 API Base URL:', API_BASE);

// homepage dates → YYYY-MM-DD
function parseDatesToApiDate(dates: string | null | undefined): string {
  const s = (dates || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split(/[/-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (c.length === 4) {
      const day = a.padStart(2, '0');
      const month = b.padStart(2, '0');
      return `${c}-${month}-${day}`;
    }
    if (a.length === 4) return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
  }
  return s;
}

// flight API error copy
function getFlightSearchErrorMessage(
  status: number,
  bodyMessage?: string | null,
  bodyText?: string
): string {
  if (status === 429) {
    return (bodyMessage && bodyMessage.trim()) || 'Flight search limit reached. Please wait a few minutes and try again.';
  }
  if (status >= 500) {
    return 'Flight search is temporarily unavailable. Please try again in a few minutes.';
  }
  if (status >= 400 && bodyMessage && bodyMessage.trim()) {
    return bodyMessage.trim();
  }
  if (bodyText && bodyText.trim()) {
    return bodyText.trim();
  }
  return 'We couldn\'t load flight results. Please try again in a moment.';
}

// hotel API error copy
function getHotelSearchErrorMessage(
  status: number,
  bodyMessage?: string | null,
  bodyText?: string
): string {
  if (status === 429) {
    return (bodyMessage && bodyMessage.trim()) || 'Hotel search limit reached. Please wait a few minutes and try again.';
  }
  if (status >= 500) {
    return 'Hotel search is temporarily unavailable. Please try again in a few minutes.';
  }
  if (status >= 400 && bodyMessage && bodyMessage.trim()) {
    return bodyMessage.trim();
  }
  if (bodyText && bodyText.trim()) {
    return bodyText.trim();
  }
  return 'We couldn\'t load hotel results. Please try again in a moment.';
}

async function fetchFlights(params?: { from?: string; to?: string; date?: string }): Promise<Flight[]> {
  try {
    // from is required; to/date optional
    if (!params?.from?.trim()) {
      console.log('⚠️ Missing from parameter:', params);
      return [];
    }

    const queryParams = new URLSearchParams();
    queryParams.append('from', params.from.trim());
    if (params.to?.trim()) queryParams.append('to', params.to.trim());
    if (params.date?.trim()) queryParams.append('date', params.date.trim());

    const url = `${API_BASE}/travel/flights?${queryParams.toString()}`;
    console.log('🔍 Fetching flights from:', url);
    console.log('📋 Search params:', { from: params.from, to: params.to, date: params.date });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('📡 Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error Response:', errorText);
      throw new Error(`Failed to fetch flights: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Flights data received:', data.length, 'flights');
    return data;
  } catch (error: any) {
    console.error('❌ Error fetching flights:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
    });
    return [];
  }
}

async function fetchHotels(params?: { location?: string; checkIn?: string; checkOut?: string; adults?: number; children?: number; rooms?: number }): Promise<Hotel[]> {
  // legacy stub — hotels go through handleHotelSearch
  return [];
}

function FlightCard({ flight, onSelect }: { flight: Flight; onSelect: (flight: Flight) => void }) {
  const isBookable = !!(flight.amadeusData || flight.bookingComToken);
  
  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300">
      <div className="relative h-48 w-full overflow-hidden">
        <img 
          src={flight.image || "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&h=300&fit=crop"} 
          alt={flight.airline}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&h=300&fit=crop';
          }}
        />
        {isBookable && (
          <div className="absolute top-3 right-3">
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full shadow-lg">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Bookable
            </span>
          </div>
        )}
      </div>
      <div className="p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-1" style={{ fontFamily: 'Raleway' }}>
              {flight.airline}
            </h3>
            <p className="text-sm text-gray-600" style={{ fontFamily: 'Inter' }}>
              {flight.flightNumber} · {flight.class}
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 mb-1">
              {flight.rating && (
                <>
                  <span className="text-yellow-400">★</span>
                  <span className="text-sm font-semibold text-gray-700">{flight.rating}</span>
                </>
              )}
            </div>
            {flight.reviewCount && (
              <p className="text-xs text-gray-500">({flight.reviewCount} reviews)</p>
            )}
          </div>
        </div>
        
        <div className="flex items-center justify-between mb-4 py-3 border-y border-gray-100">
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900" style={{ fontFamily: 'Raleway' }}>
              {flight.departure.time}
            </p>
            <p className="text-xs text-gray-600" style={{ fontFamily: 'Inter' }}>
              {flight.departure.code}
            </p>
            <p className="text-xs text-gray-500 mt-1">{flight.departure.airport}</p>
            {flight.departure.date && (
              <p className="text-xs text-gray-600 mt-1 font-medium" style={{ fontFamily: 'Inter' }}>
                {new Date(flight.departure.date + 'T12:00:00Z').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}
          </div>
          <div className="flex-1 px-4 text-center">
            <p className="text-xs text-gray-500 mb-1" style={{ fontFamily: 'Inter' }}>
              {flight.duration}
            </p>
            <div className="flex items-center">
              <div className="flex-1 h-px bg-gray-300"></div>
              <svg className="w-4 h-4 text-gray-400 mx-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <div className="flex-1 h-px bg-gray-300"></div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {flight.stops === 0 ? 'Nonstop' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900" style={{ fontFamily: 'Raleway' }}>
              {flight.arrival.time}
            </p>
            <p className="text-xs text-gray-600" style={{ fontFamily: 'Inter' }}>
              {flight.arrival.code}
            </p>
            <p className="text-xs text-gray-500 mt-1">{flight.arrival.airport}</p>
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <div>
            {flight.originalPrice && (
              <p className="text-sm text-gray-400 line-through">${flight.originalPrice}</p>
            )}
            <p className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'Raleway' }}>
              ${flight.price}
            </p>
          </div>
          <button
            onClick={() => {
              if (!isBookable) {
                onSelect(flight);
                return;
              }
              // Kiwi deep link from offer or card fields
              let origin: string | undefined;
              let destination: string | undefined;
              let departureDate: string | undefined;
              let adults = 1;
              const itinerary = flight.amadeusData?.itineraries?.[0];
              const segments = itinerary?.segments;
              if (segments?.length) {
                const firstSegment = segments[0];
                const lastSegment = segments[segments.length - 1];
                origin = firstSegment?.departure?.iataCode;
                destination = lastSegment?.arrival?.iataCode;
                departureDate = firstSegment?.departure?.at?.split('T')[0];
                adults = flight.amadeusData?.travelerPricings?.length || flight.amadeusData?.numberOfBookableSeats || 1;
              }
              if (!origin || !destination) {
                origin = flight.departure?.code;
                destination = flight.arrival?.code;
              }
              if (!departureDate && flight.departure?.date) departureDate = flight.departure.date;
              if (origin && destination && departureDate) {
                const parts = departureDate.split('-');
                const kiwiDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : departureDate;
                const queryParams = new URLSearchParams({
                  from: origin.toUpperCase(),
                  to: destination.toUpperCase(),
                  dateFrom: kiwiDate,
                  dateTo: kiwiDate,
                  adults: adults.toString(),
                });
                window.location.href = `https://www.kiwi.com/deep?${queryParams.toString()}`;
              } else {
                window.location.href = 'https://www.kiwi.com/en/search';
              }
            }}
            disabled={!isBookable}
            className={`px-6 py-2 rounded-lg transition-colors font-semibold ${
              isBookable 
                ? 'bg-[#0B1A33] text-white hover:bg-[#122a4a] cursor-pointer' 
                : 'bg-gray-400 text-white hover:bg-gray-500 cursor-not-allowed opacity-60'
            }`}
            style={{ fontFamily: 'Inter' }}
            title={isBookable ? 'Book this flight on Kiwi.com' : 'This flight is not available for booking'}
          >
            {isBookable ? 'Book' : 'Not Available'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HotelCard({ hotel, onSelect, searchParams }: { hotel: Hotel; onSelect: (hotel: Hotel, room: Room) => void; searchParams?: { checkIn?: string; checkOut?: string; adults?: number; children?: number; rooms?: number } }) {
  const [showRooms, setShowRooms] = useState(false);

  // keep rating/reviewCount as primitives for React
  const safeRating =
    typeof hotel.rating === 'number'
      ? hotel.rating
      : typeof hotel.rating === 'string'
        ? parseFloat(hotel.rating) || 0
        : hotel.rating && typeof (hotel.rating as any).rating === 'number'
          ? (hotel.rating as any).rating
          : 0;

  const safeReviewCount =
    typeof hotel.reviewCount === 'number' ? hotel.reviewCount : 0;

  const hasReviews = safeReviewCount > 0;

  return (
    <>
      <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300">
        <div className="relative h-48 w-full overflow-hidden">
          <img 
            src={hotel.image} 
            alt={hotel.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=300&fit=crop';
            }}
          />
          {hotel.stars && (
            <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1">
              {Array.from({ length: hotel.stars }).map((_, i) => (
                <span key={i} className="text-yellow-400 text-xs">★</span>
              ))}
            </div>
          )}
        </div>
        <div className="p-6">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-900 mb-1" style={{ fontFamily: 'Raleway' }}>
                {hotel.name}
              </h3>
              <p className="text-sm text-gray-600 mb-1" style={{ fontFamily: 'Inter' }}>
                {hotel.location}
              </p>
              {hotel.distance && (
                <p className="text-xs text-gray-500" style={{ fontFamily: 'Inter' }}>
                  {hotel.distance}
                </p>
              )}
              {(searchParams?.checkIn || searchParams?.checkOut) && (
                <p className="text-xs text-gray-600 mt-1 font-medium" style={{ fontFamily: 'Inter' }}>
                  {searchParams.checkIn && (
                    <>Check-in: {new Date(searchParams.checkIn + 'T12:00:00Z').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                  )}
                  {searchParams.checkIn && searchParams.checkOut && ' • '}
                  {searchParams.checkOut && (
                    <>Check-out: {new Date(searchParams.checkOut + 'T12:00:00Z').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                  )}
                </p>
              )}
            </div>
            <div className="text-right ml-4">
              {hasReviews && (
                <>
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-yellow-400">★</span>
                    <span className="text-sm font-semibold text-gray-700">
                      {safeRating}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    ({safeReviewCount} reviews)
                  </p>
                </>
              )}
            </div>
          </div>
          
          {hotel.amenities && hotel.amenities.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {hotel.amenities.slice(0, 4).map((amenity, idx) => (
                <span 
                  key={idx}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full"
                  style={{ fontFamily: 'Inter' }}
                >
                  {amenity}
                </span>
              ))}
            </div>
          )}
          
          {hotel.rooms && hotel.rooms.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-600 mb-2" style={{ fontFamily: 'Inter' }}>
                {hotel.rooms.length} room type{hotel.rooms.length > 1 ? 's' : ''} available
              </p>
              <button
                onClick={() => setShowRooms(!showRooms)}
                className="text-xs text-[#0B1A33] hover:underline font-medium"
                style={{ fontFamily: 'Inter' }}
              >
                {showRooms ? 'Hide' : 'View'} Room Types
              </button>
              {showRooms && (
                <div className="mt-2 space-y-2">
                  {hotel.rooms.map((room) => (
                    <div key={room.id} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900" style={{ fontFamily: 'Inter' }}>
                            {room.name}
                          </p>
                          <p className="text-xs text-gray-600 mt-1" style={{ fontFamily: 'Inter' }}>
                            Max {room.maxOccupancy.adults} adult{room.maxOccupancy.adults > 1 ? 's' : ''}
                            {room.maxOccupancy.children && room.maxOccupancy.children > 0 && `, ${room.maxOccupancy.children} child${room.maxOccupancy.children > 1 ? 'ren' : ''}`}
                          </p>
                          {room.bedTypes && room.bedTypes.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1" style={{ fontFamily: 'Inter' }}>
                              {room.bedTypes.join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          {room.originalPrice && (
                            <p className="text-xs text-gray-400 line-through">${room.originalPrice}</p>
                          )}
                          <p className="text-lg font-bold text-gray-900" style={{ fontFamily: 'Raleway' }}>
                            ${room.price}
                          </p>
                          <p className="text-xs text-gray-600" style={{ fontFamily: 'Inter' }}>/night</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          // Booking.com search deeplink
                          const ss = hotel.location || hotel.name;
                          const checkIn = searchParams?.checkIn;
                          const checkOut = searchParams?.checkOut;
                          const adults = searchParams?.adults || 1;
                          const children = searchParams?.children || 0;
                          const rooms = searchParams?.rooms || 1;

                          const queryParams = new URLSearchParams();
                          if (ss) queryParams.append("ss", ss);
                          if (checkIn) queryParams.append("checkin", checkIn);
                          if (checkOut) queryParams.append("checkout", checkOut);
                          queryParams.append("group_adults", String(adults));
                          queryParams.append("group_children", String(children));
                          queryParams.append("no_rooms", String(rooms));

                          const bookingLink = `https://www.booking.com/searchresults.html?${queryParams.toString()}`;
                          window.location.href = bookingLink;
                        }}
                        className="w-full mt-2 px-4 py-2 bg-[#0B1A33] text-white rounded-lg hover:bg-[#122a4a] transition-colors text-sm font-semibold"
                        style={{ fontFamily: 'Inter' }}
                      >
                        Book
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {hotel.cancellation && (
            <p className="text-xs text-green-600 mb-4" style={{ fontFamily: 'Inter' }}>
              {hotel.cancellation}
            </p>
          )}
          
          <div className="flex items-center justify-between">
            <div>
              {hotel.originalPrice && (
                <p className="text-sm text-gray-400 line-through">${hotel.originalPrice}</p>
              )}
              <div className="flex items-baseline gap-1">
                <p className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'Raleway' }}>
                  ${hotel.price}
                </p>
                {hotel.pricePerNight && (
                  <p className="text-sm text-gray-600" style={{ fontFamily: 'Inter' }}>/night</p>
                )}
              </div>
            </div>
            {hotel.rooms && hotel.rooms.length > 0 ? (
              <button 
                onClick={() => setShowRooms(!showRooms)}
                className="px-6 py-2 bg-[#0B1A33] text-white rounded-lg hover:bg-[#122a4a] transition-colors font-semibold"
                style={{ fontFamily: 'Inter' }}
              >
                {showRooms ? 'Hide Rooms' : 'View Rooms'}
              </button>
            ) : (
              <button 
                onClick={() => {
                  // Booking.com search deeplink
                  const ss = hotel.location || hotel.name;
                  const checkIn = searchParams?.checkIn;
                  const checkOut = searchParams?.checkOut;
                  const adults = searchParams?.adults || 1;
                  const children = searchParams?.children || 0;
                  const rooms = searchParams?.rooms || 1;

                  const queryParams = new URLSearchParams();
                  if (ss) queryParams.append("ss", ss);
                  if (checkIn) queryParams.append("checkin", checkIn);
                  if (checkOut) queryParams.append("checkout", checkOut);
                  queryParams.append("group_adults", String(adults));
                  queryParams.append("group_children", String(children));
                  queryParams.append("no_rooms", String(rooms));

                  const bookingLink = `https://www.booking.com/searchresults.html?${queryParams.toString()}`;
                  window.location.href = bookingLink;
                }}
                className="px-6 py-2 bg-[#0B1A33] text-white rounded-lg hover:bg-[#122a4a] transition-colors font-semibold"
                style={{ fontFamily: 'Inter' }}
              >
                Book on Booking.com
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}


type TabType = 'flights' | 'hotels';

function TravelResultsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('flights');
  const [flights, setFlights] = useState<Flight[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [flightsLoading, setFlightsLoading] = useState(false);
  const [hotelsLoading, setHotelsLoading] = useState(false);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [selectedHotel, setSelectedHotel] = useState<Hotel | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [showBookingFlow, setShowBookingFlow] = useState(false);
  const [showHotelBookingFlow, setShowHotelBookingFlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotelError, setHotelError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hotelsCurrentPage, setHotelsCurrentPage] = useState(1);
  const pageSize = 10;
  
  const [flightSearch, setFlightSearch] = useState({
    from: '',
    to: '',
    date: ''
  });
  const [filteredFlights, setFilteredFlights] = useState<Flight[]>([]);
  
  const [hotelSearch, setHotelSearch] = useState({
    location: '',
    checkIn: '',
    checkOut: '',
    adults: 1,
    children: 0,
    rooms: 1
  });
  const [filteredHotels, setFilteredHotels] = useState<Hotel[]>([]);

  // skip GPS overwrite after user types
  const fromTouchedRef = useRef(false);
  const hotelLocationTouchedRef = useRef(false);
  const travelGeoPrefillRanRef = useRef(false);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.add('page-search-events');
      return () => document.body.classList.remove('page-search-events');
    }
  }, []);

  // URL from homepage → prefill + search
  useEffect(() => {
    const from = searchParams.get('from')?.trim() || '';
    const to = searchParams.get('to')?.trim() || '';
    const dates = searchParams.get('dates')?.trim() || '';
    if (!from) return;

    const dateStr = parseDatesToApiDate(dates);
    setFlightSearch({ from, to, date: dateStr });
    setError(null);
    setFlightsLoading(true);

    const queryParams = new URLSearchParams();
    queryParams.append('from', from);
    if (to) queryParams.append('to', to);
    if (dateStr) queryParams.append('date', dateStr);
    const url = `${API_BASE}/travel/flights?${queryParams.toString()}`;

    fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          let bodyMessage: string | null = null;
          let bodyText = '';
          try {
            const body = await res.json();
            bodyMessage = body?.message ?? null;
          } catch {
            bodyText = await res.text().catch(() => '');
          }
          const message = getFlightSearchErrorMessage(res.status, bodyMessage, bodyText);
          throw new Error(message);
        }
        return res.json();
      })
      .then((data: Flight[]) => {
        if (!Array.isArray(data)) throw new Error('We couldn\'t load flight results. Please try again in a moment.');
        setFlights(data);
        setFilteredFlights(data);
        setCurrentPage(1);
        if (data.length === 0) {
          setError('No flights found for this search. Try different cities or dates.');
        }
      })
      .catch((err: any) => {
        const msg = err?.message;
        const isNetwork = typeof msg === 'string' && (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('network'));
        setError(msg && !isNetwork ? msg : 'We couldn\'t reach the server. Check your connection and try again.');
        setFlights([]);
        setFilteredFlights([]);
      })
      .finally(() => setFlightsLoading(false));
  }, [searchParams]);

  // GPS prefill once/session if from/location still empty
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (travelGeoPrefillRanRef.current) return;

      const fromInUrl = searchParams.get("from")?.trim() || "";
      const needFlightFrom = !fromInUrl && !flightSearch.from.trim();
      const needHotelLocation = !hotelSearch.location.trim();

      if (!needFlightFrom && !needHotelLocation) return;
      if (fromTouchedRef.current && needFlightFrom) return;
      if (hotelLocationTouchedRef.current && needHotelLocation) return;

      travelGeoPrefillRanRef.current = true;
      const label = await getGeoLocationLabelOncePerSession();
      if (cancelled) return;
      if (!label || !label.trim()) return;
      if (needFlightFrom && !fromTouchedRef.current) {
        setFlightSearch((prev) => ({ ...prev, from: label }));
        await handleFlightSearch({ from: label });
      }

      if (needHotelLocation && !hotelLocationTouchedRef.current) {
        setHotelSearch((prev) => ({ ...prev, location: label }));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // client-side filter as search fields change
  useEffect(() => {
    if (flights.length === 0) {
      setFilteredFlights([]);
      setCurrentPage(1);
      return;
    }

    if (flightSearch.from || flightSearch.to || flightSearch.date) {
      const filtered = flights.filter(flight => {
        const matchesFrom = !flightSearch.from || 
          flight.departure.code.toLowerCase().includes(flightSearch.from.toLowerCase()) ||
          flight.departure.airport.toLowerCase().includes(flightSearch.from.toLowerCase());
        const matchesTo = !flightSearch.to || 
          flight.arrival.code.toLowerCase().includes(flightSearch.to.toLowerCase()) ||
          flight.arrival.airport.toLowerCase().includes(flightSearch.to.toLowerCase());
        const matchesDate = !flightSearch.date || flight.departure.date === flightSearch.date;
        return matchesFrom && matchesTo && matchesDate;
      });
      setFilteredFlights(filtered);
      setCurrentPage(1);
    } else {
      setFilteredFlights(flights);
    }
  }, [flightSearch, flights]);

  const paginatedFlights = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginated = filteredFlights.slice(start, end);
    console.log(`📄 Page ${currentPage}: Showing ${paginated.length} flights (${start + 1}-${Math.min(end, filteredFlights.length)} of ${filteredFlights.length} total)`);
    return paginated;
  }, [filteredFlights, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredFlights.length / pageSize);
  
  useEffect(() => {
    if (flights.length > 0 || filteredFlights.length > 0) {
      console.log(`🔢 Flight State - Total loaded: ${flights.length}, Filtered: ${filteredFlights.length}, Showing on page: ${paginatedFlights.length}, Current page: ${currentPage}/${totalPages}`);
      if (flights.length < 50) {
        console.warn(`⚠️ Only ${flights.length} flights loaded - expected more. Check backend logs.`);
      }
    }
  }, [flights.length, filteredFlights.length, paginatedFlights.length, currentPage, totalPages]);

  const handleFlightSearch = async (override?: Partial<typeof flightSearch>) => {
    const nextSearch = { ...flightSearch, ...(override || {}) };
    if (!nextSearch.from?.trim()) {
      setError('Please enter a departure city or airport code.');
      return;
    }

    setFlightsLoading(true);
    setError(null);
    
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('from', nextSearch.from.trim());
      if (nextSearch.to?.trim()) queryParams.append('to', nextSearch.to.trim());
      if (nextSearch.date?.trim()) {
        queryParams.append('date', nextSearch.date.trim());
      }

      const url = `${API_BASE}/travel/flights?${queryParams.toString()}`;
      console.log('🔍 Searching flights:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('📡 Response status:', response.status);

      if (!response.ok) {
        let bodyMessage: string | null = null;
        let bodyText = '';
        try {
          const body = await response.json();
          bodyMessage = body?.message ?? null;
        } catch {
          bodyText = await response.text().catch(() => '');
        }
        const message = getFlightSearchErrorMessage(response.status, bodyMessage, bodyText);
        throw new Error(message);
      }

      const flights = await response.json();
      console.log('✅ Flights received:', flights.length);
      
      if (!Array.isArray(flights)) {
        console.error('❌ Invalid response format:', flights);
        throw new Error('We couldn\'t load flight results. Please try again in a moment.');
      }
      
      setFlights(flights);
      setFilteredFlights(flights);
      setCurrentPage(1);
      
      if (flights.length === 0) {
        setError('No flights found for your search. Try different dates or airports.');
      }
    } catch (error: any) {
      console.error('❌ Error in handleFlightSearch:', error);
      const msg = error?.message;
      const isNetwork = typeof msg === 'string' && (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('network'));
      setError(msg && !isNetwork ? msg : 'We couldn\'t reach the server. Check your connection and try again.');
    } finally {
      setFlightsLoading(false);
    }
  };

  const handleClearSearch = () => {
    setFlightSearch({ from: '', to: '', date: '' });
    setError(null);
    setFlights([]);
    setFilteredFlights([]);
    setCurrentPage(1);
    router.replace('/search/travel');
  };

  const handleHotelSearch = async () => {
    if (!hotelSearch.location || hotelSearch.location.trim() === '') {
      setHotelError('Please enter a location.');
      return;
    }

    if (hotelSearch.checkIn && hotelSearch.checkOut) {
      const checkInDate = new Date(hotelSearch.checkIn);
      const checkOutDate = new Date(hotelSearch.checkOut);
      if (checkOutDate <= checkInDate) {
        setHotelError('Check-out date must be after check-in date.');
        return;
      }
    }

    console.log('🔍 Searching hotels with:', {
      location: hotelSearch.location,
      checkIn: hotelSearch.checkIn || 'not provided',
      checkOut: hotelSearch.checkOut || 'not provided',
      adults: hotelSearch.adults
    });

    setHotelsLoading(true);
    setHotelError(null);
    
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('location', hotelSearch.location);
      if (hotelSearch.checkIn) queryParams.append('checkIn', hotelSearch.checkIn);
      if (hotelSearch.checkOut) queryParams.append('checkOut', hotelSearch.checkOut);
      const adults = Math.max(1, hotelSearch.adults || 0);
      const children = Math.max(0, hotelSearch.children ?? 0);
      queryParams.append('adults', adults.toString());
      queryParams.append('children', children.toString());
      queryParams.append('rooms', hotelSearch.rooms.toString());

      const url = `${API_BASE}/travel/hotels?${queryParams.toString()}`;
      console.log('🔍 Searching hotels:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      console.log('📡 Response status:', response.status);

      if (!response.ok) {
        let bodyMessage: string | null = null;
        let bodyText = '';
        try {
          const body = await response.json();
          bodyMessage = body?.message ?? null;
        } catch {
          bodyText = await response.text().catch(() => '');
        }
        const message = getHotelSearchErrorMessage(response.status, bodyMessage, bodyText);
        throw new Error(message);
      }

      const hotels = await response.json();
      console.log('✅ Hotels received:', hotels.length);
      
      if (!Array.isArray(hotels)) {
        console.error('❌ Invalid response format:', hotels);
        throw new Error('We couldn\'t load hotel results. Please try again in a moment.');
      }
      
      setHotels(hotels);
      setFilteredHotels(hotels);
      setHotelsCurrentPage(1);
      
      if (hotels.length === 0) {
        setHotelError('No hotels found for your search criteria. Please try different dates or location.');
      }
    } catch (error: any) {
      console.error('❌ Error in handleHotelSearch:', error);
      const msg = error?.message;
      const isNetwork = typeof msg === 'string' && (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('network'));
      setHotelError(msg && !isNetwork ? msg : 'We couldn\'t reach the server. Check your connection and try again.');
    } finally {
      setHotelsLoading(false);
    }
  };

  const handleClearHotelSearch = () => {
    setHotelSearch({ location: '', checkIn: '', checkOut: '', adults: 1, children: 0, rooms: 1 });
    setHotelError(null);
    setHotels([]);
    setFilteredHotels([]);
    setHotelsCurrentPage(1);
  };

  useEffect(() => {
    if (hotels.length === 0) {
      setFilteredHotels([]);
      setHotelsCurrentPage(1);
      return;
    }

    if (hotelSearch.location || hotelSearch.checkIn || hotelSearch.checkOut) {
      const filtered = hotels.filter(hotel => {
        const matchesLocation = !hotelSearch.location || 
          hotel.location.toLowerCase().includes(hotelSearch.location.toLowerCase()) ||
          hotel.name.toLowerCase().includes(hotelSearch.location.toLowerCase());
        return matchesLocation;
      });
      setFilteredHotels(filtered);
      setHotelsCurrentPage(1);
    } else {
      setFilteredHotels(hotels);
    }
  }, [hotelSearch, hotels]);

  const paginatedHotels = useMemo(() => {
    const start = (hotelsCurrentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginated = filteredHotels.slice(start, end);
    console.log(`📄 Hotels Page ${hotelsCurrentPage}: Showing ${paginated.length} hotels (${start + 1}-${Math.min(end, filteredHotels.length)} of ${filteredHotels.length} total)`);
    return paginated;
  }, [filteredHotels, hotelsCurrentPage, pageSize]);

  const hotelsTotalPages = Math.ceil(filteredHotels.length / pageSize);

  const tabs = [
    { id: 'flights' as TabType, label: 'Flights' },
    { id: 'hotels' as TabType, label: 'Hotels' }
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="pt-32 pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      py-4 px-1 border-b-2 font-medium text-sm transition-colors
                      ${activeTab === tab.id
                        ? 'border-[#0B1A33] text-[#0B1A33]'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }
                    `}
                    style={{ fontFamily: 'Inter' }}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          <div>
            {activeTab === 'flights' && (
              <div>
                <div className="mb-4">
                  <h2 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'Inter' }}>
                    Search for Flights
                  </h2>
                  <p className="text-sm text-gray-600 mt-1" style={{ fontFamily: 'Inter' }}>
                    Find the best flight deals for your next trip
                  </p>
                </div>
                
                <div className="mb-6 bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                        From
                      </label>
                      <input
                        type="text"
                        placeholder="City or Airport Code"
                        value={flightSearch.from}
                        onChange={(e) => {
                          fromTouchedRef.current = true;
                          setFlightSearch({ ...flightSearch, from: e.target.value });
                          if (e.target.value.trim() && error === "Please enter a 'From' city or airport code to search for flights.") {
                            setError(null);
                          }
                        }}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-[#0B1A33] transition-all"
                        style={{ fontFamily: 'Inter' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                        To
                      </label>
                      <input
                        type="text"
                        placeholder="City or Airport Code"
                        value={flightSearch.to}
                        onChange={(e) => setFlightSearch({ ...flightSearch, to: e.target.value })}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-[#0B1A33] transition-all"
                        style={{ fontFamily: 'Inter' }}
                      />
                    </div>
                           <div>
                             <label className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                               Date <span className="text-gray-400 text-xs">(Optional)</span>
                             </label>
                             <input
                               type="date"
                               value={flightSearch.date}
                               onChange={(e) => setFlightSearch({ ...flightSearch, date: e.target.value })}
                               className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-[#0B1A33] transition-all"
                               style={{ fontFamily: 'Inter' }}
                               placeholder="Select date (optional)"
                             />
                           </div>
                    <div className="flex items-end gap-2">
                      {(flightSearch.from || flightSearch.to || flightSearch.date) && (
                        <button
                          onClick={handleClearSearch}
                          className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
                          style={{ fontFamily: 'Inter' }}
                        >
                          Clear
                        </button>
                      )}
                      <button
                        onClick={handleFlightSearch}
                        className="flex-1 px-6 py-3 bg-[#0B1A33] text-white rounded-lg hover:bg-[#122a4a] transition-colors font-semibold"
                        style={{ fontFamily: 'Inter' }}
                      >
                        Search Flights
                      </button>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-600" style={{ fontFamily: 'Inter' }}>
                      ❌ Error: {error}
                    </p>
                  </div>
                )}
                {flightsLoading ? (
                  <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#0B1A33] mb-4"></div>
                    <p className="text-lg font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                      Searching for flights...
                    </p>
                    <p className="text-sm text-gray-500" style={{ fontFamily: 'Inter' }}>
                      This may take a few seconds
                    </p>
                  </div>
                ) : filteredFlights.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500 text-lg" style={{ fontFamily: 'Inter' }}>
                      {flightSearch.from || flightSearch.to || flightSearch.date 
                        ? 'No flights found for your search criteria. Try adjusting your search or click "Search Flights" to find available flights.' 
                        : 'Enter your search criteria above and click "Search Flights" to find available flights.'}
                    </p>
                    {(!flightSearch.from && !flightSearch.to && !flightSearch.date) && (
                      <p className="text-gray-400 text-sm mt-2" style={{ fontFamily: 'Inter' }}>
                        Search by entering at least From (To and date optional)
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {paginatedFlights.map((flight) => (
                        <FlightCard 
                          key={flight.id} 
                          flight={flight} 
                          onSelect={(flight) => {
                            setSelectedFlight(flight);
                            setShowBookingFlow(true);
                          }}
                        />
                      ))}
                    </div>
                    {filteredFlights.length > pageSize && (
                      <div className="flex items-center justify-center gap-3 mt-8">
                        <button
                          disabled={currentPage <= 1 || flightsLoading}
                          onClick={() => {
                            setCurrentPage(p => Math.max(1, p - 1));
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                          style={{ fontFamily: 'Inter' }}
                        >
                          ← Previous
                        </button>
                        <span className="text-sm text-gray-600 font-medium" style={{ fontFamily: 'Inter' }}>
                          Page {currentPage} of {totalPages} • Showing {paginatedFlights.length} of {filteredFlights.length} flights
                        </span>
                        <button
                          disabled={currentPage >= totalPages || flightsLoading}
                          onClick={() => {
                            setCurrentPage(p => p + 1);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                          style={{ fontFamily: 'Inter' }}
                        >
                          Next →
                        </button>
                      </div>
                    )}
                    {filteredFlights.length <= pageSize && filteredFlights.length > 0 && (
                      <div className="text-center mt-6">
                        <span className="text-sm text-gray-600 font-medium" style={{ fontFamily: 'Inter' }}>
                          Showing all {filteredFlights.length} flights
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeTab === 'hotels' && (
              <div>
                <div className="mb-4">
                  <h2 className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'Inter' }}>
                    Search for Hotels
                  </h2>
                  <p className="text-sm text-gray-600 mt-1" style={{ fontFamily: 'Inter' }}>
                    Find the best hotel deals for your stay
                  </p>
                </div>
                
                <div className="mb-6 bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                        Location
                      </label>
                      <input
                        type="text"
                        placeholder="City or Hotel Name"
                        value={hotelSearch.location}
                        onChange={(e) => {
                          hotelLocationTouchedRef.current = true;
                          setHotelSearch({ ...hotelSearch, location: e.target.value });
                        }}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-[#0B1A33] transition-all"
                        style={{ fontFamily: 'Inter' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                        Check-in <span className="text-gray-400 text-xs">(Optional)</span>
                      </label>
                      <input
                        type="date"
                        value={hotelSearch.checkIn}
                        onChange={(e) => setHotelSearch({ ...hotelSearch, checkIn: e.target.value })}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-[#0B1A33] transition-all"
                        style={{ fontFamily: 'Inter' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                        Check-out <span className="text-gray-400 text-xs">(Optional)</span>
                      </label>
                      <input
                        type="date"
                        value={hotelSearch.checkOut}
                        onChange={(e) => setHotelSearch({ ...hotelSearch, checkOut: e.target.value })}
                        min={hotelSearch.checkIn || new Date().toISOString().split('T')[0]}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-[#0B1A33] transition-all"
                        style={{ fontFamily: 'Inter' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                        Adults
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="1"
                        value={hotelSearch.adults === 0 ? '' : hotelSearch.adults}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') {
                            setHotelSearch({ ...hotelSearch, adults: 0 });
                            return;
                          }
                          const n = parseInt(v, 10);
                          if (!isNaN(n) && n >= 0) setHotelSearch({ ...hotelSearch, adults: n });
                        }}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-[#0B1A33] transition-all"
                        style={{ fontFamily: 'Inter' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                        Children
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={hotelSearch.children === 0 ? '' : hotelSearch.children}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') {
                            setHotelSearch({ ...hotelSearch, children: 0 });
                            return;
                          }
                          const n = parseInt(v, 10);
                          if (!isNaN(n) && n >= 0) setHotelSearch({ ...hotelSearch, children: n });
                        }}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-[#0B1A33] transition-all"
                        style={{ fontFamily: 'Inter' }}
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      {(hotelSearch.location || hotelSearch.checkIn || hotelSearch.checkOut) && (
                        <button
                          onClick={handleClearHotelSearch}
                          className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
                          style={{ fontFamily: 'Inter' }}
                        >
                          Clear
                        </button>
                      )}
                      <button
                        onClick={handleHotelSearch}
                        className="flex-1 px-6 py-3 bg-[#0B1A33] text-white rounded-lg hover:bg-[#122a4a] transition-colors font-semibold"
                        style={{ fontFamily: 'Inter' }}
                      >
                        Search Hotels
                      </button>
                    </div>
                  </div>
                </div>

                {hotelError && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-600" style={{ fontFamily: 'Inter' }}>
                      ❌ Error: {hotelError}
                    </p>
                  </div>
                )}

                {hotelsLoading ? (
                  <div className="text-center py-12">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#0B1A33] mb-4"></div>
                    <p className="text-lg font-semibold text-gray-700 mb-2" style={{ fontFamily: 'Inter' }}>
                      Searching for hotels...
                    </p>
                    <p className="text-sm text-gray-500" style={{ fontFamily: 'Inter' }}>
                      This may take a few seconds
                    </p>
                  </div>
                ) : filteredHotels.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500 text-lg" style={{ fontFamily: 'Inter' }}>
                      {hotelSearch.location || hotelSearch.checkIn || hotelSearch.checkOut
                        ? 'No hotels found for your search criteria. Try adjusting your search or click "Search Hotels" to find available hotels.'
                        : 'Enter your search criteria above and click "Search Hotels" to find available hotels.'}
                    </p>
                    {(!hotelSearch.location && !hotelSearch.checkIn && !hotelSearch.checkOut) && (
                      <p className="text-gray-400 text-sm mt-2" style={{ fontFamily: 'Inter' }}>
                        Search by entering Location (Check-in and Check-out dates are optional)
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {paginatedHotels.map((hotel) => (
                        <HotelCard 
                          key={hotel.id} 
                          hotel={hotel}
                          searchParams={{
                            checkIn: hotelSearch.checkIn,
                            checkOut: hotelSearch.checkOut,
                            adults: hotelSearch.adults,
                            children: hotelSearch.children,
                            rooms: hotelSearch.rooms,
                          }}
                          onSelect={(hotel, room) => {
                            setSelectedHotel(hotel);
                            setSelectedRoom(room);
                            setShowHotelBookingFlow(true);
                          }}
                        />
                      ))}
                    </div>
                    {filteredHotels.length > pageSize && (
                      <div className="flex items-center justify-center gap-3 mt-8">
                        <button
                          disabled={hotelsCurrentPage <= 1 || hotelsLoading}
                          onClick={() => {
                            setHotelsCurrentPage(p => Math.max(1, p - 1));
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                          style={{ fontFamily: 'Inter' }}
                        >
                          ← Previous
                        </button>
                        <span className="text-sm text-gray-600 font-medium" style={{ fontFamily: 'Inter' }}>
                          Page {hotelsCurrentPage} of {hotelsTotalPages} • Showing {paginatedHotels.length} of {filteredHotels.length} hotels
                        </span>
                        <button
                          disabled={hotelsCurrentPage >= hotelsTotalPages || hotelsLoading}
                          onClick={() => {
                            setHotelsCurrentPage(p => p + 1);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                          style={{ fontFamily: 'Inter' }}
                        >
                          Next →
                        </button>
                      </div>
                    )}
                    {filteredHotels.length <= pageSize && filteredHotels.length > 0 && (
                      <div className="text-center mt-6">
                        <span className="text-sm text-gray-600 font-medium" style={{ fontFamily: 'Inter' }}>
                          Showing all {filteredHotels.length} hotels
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

          </div>
        </div>
      </div>

      <Footer />

      {showBookingFlow && selectedFlight && (
        <FlightBookingFlow
          flight={selectedFlight}
          onClose={() => {
            setShowBookingFlow(false);
            setSelectedFlight(null);
          }}
        />
      )}

      {showHotelBookingFlow && selectedHotel && selectedRoom && (
        <HotelBookingFlow
          hotel={selectedHotel}
          room={selectedRoom}
          searchParams={{
            checkIn: hotelSearch.checkIn,
            checkOut: hotelSearch.checkOut,
            adults: hotelSearch.adults,
            children: hotelSearch.children,
            rooms: hotelSearch.rooms,
            nights: (hotelSearch.checkIn && hotelSearch.checkOut) 
              ? Math.ceil((new Date(hotelSearch.checkOut).getTime() - new Date(hotelSearch.checkIn).getTime()) / (1000 * 60 * 60 * 24))
              : 1
          }}
          onClose={() => {
            setShowHotelBookingFlow(false);
            setSelectedHotel(null);
            setSelectedRoom(null);
          }}
          onComplete={async (bookingData): Promise<void> => {
            try {
              // need amadeusData to book
              if (!selectedRoom || !selectedRoom.amadeusData) {
                console.error('❌ CRITICAL: Hotel room amadeusData is missing');
                alert('Hotel room data is missing. Please search again and select a room.');
                return;
              }

              if (!selectedRoom.amadeusData.id) {
                console.error('❌ CRITICAL: Hotel offer missing ID:', selectedRoom.amadeusData);
                alert('Invalid room data: Missing booking information. Please search again and select a different room.');
                return;
              }

              // payment fields
              if (!bookingData.paymentInfo) {
                alert('Payment information is missing. Please fill in all payment details.');
                return;
              }

              if (!bookingData.paymentInfo.expiryDate) {
                alert('Payment card expiry date is required.');
                return;
              }

              if (!bookingData.paymentInfo.cardNumber || bookingData.paymentInfo.cardNumber.replace(/\s/g, '').length < 13) {
                alert('Please enter a valid payment card number.');
                return;
              }

              if (!bookingData.paymentInfo.cardholderName || bookingData.paymentInfo.cardholderName.trim().length === 0) {
                alert('Payment card holder name is required.');
                return;
              }

              // normalize total
              let bookingTotal = 0;
              if (typeof bookingData.total === 'number') {
                bookingTotal = bookingData.total;
              } else if (bookingData.total && typeof bookingData.total === 'object' && bookingData.total.total) {
                bookingTotal = bookingData.total.total;
              } else {
                const nights = bookingData.searchParams?.nights || 1;
                const rooms = bookingData.searchParams?.rooms || 1;
                bookingTotal = (selectedRoom.price * nights * rooms) * 1.15; // Add 15% tax
              }

              const apiBase = resolveApiBaseUrl();
              
              const guests = [{
                title: 'MR',
                firstName: bookingData.guestInfo?.firstName || '',
                lastName: bookingData.guestInfo?.lastName || '',
                phone: bookingData.guestInfo?.phone || '',
              }];

              // MM/YY → YYYY-MM
              let expiryDate = '2025-12';
              if (bookingData.paymentInfo.expiryDate) {
                try {
                  const expiryStr = bookingData.paymentInfo.expiryDate.toString();
                  if (expiryStr.includes('/')) {
                    const [month, year] = expiryStr.split('/');
                    if (month && year) {
                      expiryDate = `20${year.trim()}-${month.trim().padStart(2, '0')}`;
                    }
                  } else if (expiryStr.includes('-')) {
                    expiryDate = expiryStr;
                  }
                } catch (e) {
                  console.error('Error formatting expiry date:', e);
                }
              }

              const cardNumber = (bookingData.paymentInfo.cardNumber || '').toString().replace(/\s/g, '');
              const payment = {
                cardType: cardNumber.startsWith('4') ? 'VI' : 'MC',
                cardNumber: cardNumber,
                expiryDate: expiryDate,
                holderName: (bookingData.paymentInfo.cardholderName || '').toString(),
              };

              const response = await fetch(`${apiBase}/travel/bookings`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                  type: 'hotel',
                  itemData: {
                    hotel: {
                      id: selectedHotel.id,
                      name: selectedHotel.name,
                      location: selectedHotel.location,
                      address: selectedHotel.address,
                      image: selectedHotel.image,
                      stars: selectedHotel.stars,
                      rating: selectedHotel.rating,
                      amadeusData: selectedRoom.amadeusData,
                    },
                    guests: guests,
                    payment: {
                      cardType: payment.cardType,
                      cardNumber: payment.cardNumber,
                      expiryDate: payment.expiryDate,
                      holderName: payment.holderName,
                    },
                    guestInfo: bookingData.guestInfo,
                    searchParams: bookingData.searchParams,
                    priceBreakdown: typeof bookingData.total === 'object' ? bookingData.total : {
                      base: bookingTotal / 1.15,
                      taxes: bookingTotal * 0.15 / 1.15,
                      total: bookingTotal,
                    },
                  },
                  price: bookingTotal.toString(),
                  fullName: `${bookingData.guestInfo?.firstName || ''} ${bookingData.guestInfo?.lastName || ''}`.trim(),
                  email: bookingData.guestInfo?.email || '',
                }),
              });

              if (!response.ok) {
                let errorMessage = 'Failed to create booking. Please try again.';
                try {
                  const errorData = await response.json();
                  if (errorData.message) {
                    errorMessage = errorData.message;
                  } else if (Array.isArray(errorData.message) && errorData.message.length > 0) {
                    errorMessage = errorData.message[0].detail || errorData.message[0].title || errorMessage;
                  } else if (errorData.response && Array.isArray(errorData.response) && errorData.response.length > 0) {
                    errorMessage = errorData.response[0].detail || errorData.response[0].title || errorMessage;
                  }
                } catch (e) {
                  const errorText = await response.text().catch(() => '');
                  if (errorText) {
                    try {
                      const parsed = JSON.parse(errorText);
                      if (parsed.message) errorMessage = parsed.message;
                    } catch {
                      errorMessage = errorText || errorMessage;
                    }
                  }
                }
                console.error('❌ Hotel booking failed - throwing error to prevent fake confirmation');
                throw new Error(errorMessage);
              }

              const bookingResult = await response.json();
              console.log('✅ Hotel booking successful:', bookingResult);
              
              // require real Amadeus booking id
              const amadeusBookingId = bookingResult.amadeusHotelBookingId || bookingResult.itemData?.amadeusHotelBookingId;
              
              if (!amadeusBookingId) {
                console.error('❌ CRITICAL: Booking response missing Amadeus booking ID');
                console.error('❌ Booking result:', bookingResult);
                throw new Error('Booking confirmation failed: No Amadeus booking ID received. The booking was NOT confirmed. This is NOT a valid booking.');
              }

              if (typeof amadeusBookingId !== 'string' || amadeusBookingId.trim().length === 0) {
                console.error('❌ CRITICAL: Amadeus booking ID is empty or invalid');
                throw new Error('Booking confirmation failed: Invalid Amadeus booking ID received. The booking was NOT confirmed. This is NOT a valid booking.');
              }

              console.log('✅ CRITICAL VALIDATION PASSED: Real Amadeus booking confirmed with ID:', amadeusBookingId);
              
              setShowHotelBookingFlow(false);
              setSelectedHotel(null);
              setSelectedRoom(null);
              window.location.href = '/profile/bookings';
            } catch (error: any) {
              console.error('❌ Error creating hotel booking:', error);
              throw error;
            }
          }}
        />
      )}
    </main>
  );
}

export default function TravelResultsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#0B1A33] mb-4" />
            <p className="text-gray-600" style={{ fontFamily: 'Inter' }}>
              Loading travel search...
            </p>
          </div>
        </main>
      }
    >
      <TravelResultsContent />
    </Suspense>
  );
}
