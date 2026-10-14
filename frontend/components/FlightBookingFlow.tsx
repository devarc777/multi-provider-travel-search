"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRoleContext } from "./RoleContext";

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

interface Flight {
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

interface FlightBookingFlowProps {
  flight: Flight;
  onClose: () => void;
}

type BookingStep = 'passengers' | 'baggage' | 'fare' | 'seating' | 'payment';

interface Passenger {
  title: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  passportNumber: string;
  passportExpiry: string;
  email: string;
  phone?: string;
}

export default function FlightBookingFlow({ flight, onClose }: FlightBookingFlowProps) {
  const router = useRouter();
  const { isAuthenticated, user, checkAuth, authChecked } = useRoleContext();
  const [currentStep, setCurrentStep] = useState<BookingStep>('passengers');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<any>(null);
  
  const [passengers, setPassengers] = useState<Passenger[]>([{
    title: 'Mr',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    nationality: '',
    passportNumber: '',
    passportExpiry: '',
    email: user?.email || '',
    phone: ''
  }]);
  
  const [baggage, setBaggage] = useState({
    cabin: true,
    checked: false,
    checkedWeight: 0
  });
  
  const [selectedFare, setSelectedFare] = useState<'saver' | 'standard' | 'flexible'>('saver');
  const [insurance, setInsurance] = useState(false);
  const [seats, setSeats] = useState<{ [key: string]: string }>({});
  
  const [paymentInfo, setPaymentInfo] = useState({
    cardNumber: '',
    expiryDate: '',
    cvc: '',
    cardholderName: '',
    billingAddress: '',
    billingCity: '',
    billingZip: '',
    billingCountry: ''
  });

  // price freshness
  const [refreshingPrice, setRefreshingPrice] = useState(false);
  const [validatedPrice, setValidatedPrice] = useState<number | null>(null);
  const [priceValidatedAt, setPriceValidatedAt] = useState<string | null>(null);
  
  const getSearchAgeMinutes = (): number => {
    if (!flight.searchTimestamp) return 0;
    const searchTime = new Date(flight.searchTimestamp).getTime();
    const now = Date.now();
    return Math.floor((now - searchTime) / 60000);
  };

  const isSearchStale = (): boolean => {
    return getSearchAgeMinutes() > 2;
  };

  // re-validate price with Amadeus
  const refreshPrice = async () => {
    if (!flight.amadeusData) {
      setError('Flight data is missing. Please search again.');
      return;
    }

    setRefreshingPrice(true);
    setError(null);

    try {
      console.log('🔄 Refreshing flight price...');
      
      const response = await fetch(`${API_BASE}/travel/flights/validate-price`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ flightOffer: flight.amadeusData }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to refresh price' }));
        throw new Error(errorData.message || 'Failed to refresh price');
      }

      const data = await response.json();
      console.log('✅ Price refreshed:', data);
      
      setValidatedPrice(data.validatedPrice);
      setPriceValidatedAt(new Date().toISOString());
      
      flight.amadeusData = data.validatedOffer;
      flight.price = data.validatedPrice;
      
      return data;
    } catch (err: any) {
      console.error('❌ Price refresh error:', err);
      setError(err.message || 'Failed to refresh price. Please search for flights again.');
      throw err;
    } finally {
      setRefreshingPrice(false);
    }
  };

  const steps = [
    { id: 'passengers' as BookingStep, label: 'Passengers', number: 1 },
    { id: 'baggage' as BookingStep, label: 'Baggage & Insurance', number: 2 },
    { id: 'fare' as BookingStep, label: 'Fare Type', number: 3 },
    { id: 'seating' as BookingStep, label: 'Seating', number: 4 },
    { id: 'payment' as BookingStep, label: 'Payment', number: 5 }
  ];

  useEffect(() => {
    checkAuth();
    
    const verifyAuth = async () => {
      const apiBase = resolveApiBaseUrl();
      try {
        const response = await fetch(`${apiBase}/auth/me`, {
          method: 'GET',
          credentials: 'include',
        });
        
        if (!response.ok) {
          console.warn('⚠️ User not authenticated - booking will require login');
          setError('Please log in to complete your booking. You can continue filling out the form, but you will need to log in before completing the booking.');
        } else {
          const userData = await response.json();
          console.log('✅ User authenticated:', userData.email);
          setError(null);
        }
      } catch (error) {
        console.error('Error checking auth:', error);
      }
    };
    
    verifyAuth();
  }, [checkAuth, isAuthenticated, flight.id]);

  const calculatePrice = () => {
    let basePrice = flight.price * passengers.length;
    let total = basePrice;
    let breakdown = {
      base: basePrice,
      fare: 0,
      baggage: 0,
      insurance: 0,
      total: basePrice
    };
    
    const farePricePerPassenger = selectedFare === 'standard' ? 20 : selectedFare === 'flexible' ? 50 : 0;
    breakdown.fare = farePricePerPassenger * passengers.length;
    total += breakdown.fare;
    
    if (baggage.checked && baggage.checkedWeight > 0) {
      breakdown.baggage = baggage.checkedWeight * 15 * passengers.length;
      total += breakdown.baggage;
    }
    
    if (insurance) {
      breakdown.insurance = 25 * passengers.length;
      total += breakdown.insurance;
    }
    
    breakdown.total = total;
    return breakdown;
  };

  const priceBreakdown = calculatePrice();

  const validatePassengers = () => {
    for (const passenger of passengers) {
      if (!passenger.firstName || !passenger.lastName) {
        return 'Please fill in all required passenger information (First Name and Last Name)';
      }
      if (!passenger.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(passenger.email)) {
        return 'Please enter a valid email address for all passengers';
      }
      if (!passenger.dateOfBirth) {
        return 'Please enter date of birth for all passengers';
      }
      if (!passenger.nationality) {
        return 'Please enter nationality for all passengers';
      }
    }
    return null;
  };

  const validatePayment = () => {
    if (!paymentInfo.cardNumber || paymentInfo.cardNumber.replace(/\s/g, '').length < 16) {
      return 'Please enter a valid card number';
    }
    if (!paymentInfo.expiryDate || !/^\d{2}\/\d{2}$/.test(paymentInfo.expiryDate)) {
      return 'Please enter a valid expiry date (MM/YY)';
    }
    if (!paymentInfo.cvc || paymentInfo.cvc.length < 3) {
      return 'Please enter a valid CVC';
    }
    if (!paymentInfo.cardholderName) {
      return 'Please enter cardholder name';
    }
    return null;
  };

  const handleNext = async () => {
    setError(null);
    
    if (currentStep === 'passengers') {
      const validationError = validatePassengers();
      if (validationError) {
        setError(validationError);
        return;
      }
      
      setCurrentStep('baggage');
    } else if (currentStep === 'baggage') {
      setCurrentStep('fare');
    } else if (currentStep === 'fare') {
      setCurrentStep('seating');
    } else if (currentStep === 'seating') {
      setCurrentStep('payment');
    } else if (currentStep === 'payment') {
      const validationError = validatePayment();
      if (validationError) {
        setError(validationError);
        return;
      }
      
      if (!authChecked) {
        setLoading(true);
        await checkAuth();
        setLoading(false);
      }
      
      if (!isAuthenticated) {
        setLoading(true);
        await checkAuth();
        setLoading(false);
        
        if (!isAuthenticated) {
          const redirectParam = encodeURIComponent('/profile/bookings');
          router.push(`/auth/login?redirect=${redirectParam}`);
          return;
        }
      }
      
      await handleBooking();
    }
  };

  const handleBooking = async () => {
    setLoading(true);
    setError(null);
    
    try {
      if (!authChecked) {
        await checkAuth();
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      const apiBase = resolveApiBaseUrl();
      const authCheckResponse = await fetch(`${apiBase}/auth/me`, {
        method: 'GET',
        credentials: 'include',
      });
      
      if (!authCheckResponse.ok) {
        setLoading(false);
        setError('You must be logged in to complete a booking. Please log in and then try again.');
        // stash draft for resume after login
        try {
          sessionStorage.setItem('pendingFlightBooking', JSON.stringify({
            flight: {
              id: flight.id,
              airline: flight.airline,
              flightNumber: flight.flightNumber,
              departure: flight.departure,
              arrival: flight.arrival,
              duration: flight.duration,
              stops: flight.stops,
              class: flight.class,
              price: flight.price,
              amadeusData: flight.amadeusData,
            },
            passengers,
            baggage,
            selectedFare,
            insurance,
            seats,
            priceBreakdown
          }));
        } catch (e) {
          console.error('Failed to save booking data:', e);
        }
        setTimeout(() => {
          const redirectParam = encodeURIComponent('/search/travel');
          router.push(`/auth/login?redirect=${redirectParam}`);
        }, 3000);
        return;
      }
      
      const userData = await authCheckResponse.json();
      console.log('✅ User authenticated:', userData.email);

      if (!flight.amadeusData) {
        throw new Error('Flight data is missing. Please search again and select a flight.');
      }

      const bookingData = {
        type: 'flight',
        itemData: {
          flight: {
            id: flight.id,
            airline: flight.airline,
            flightNumber: flight.flightNumber,
            departure: flight.departure,
            arrival: flight.arrival,
            duration: flight.duration,
            stops: flight.stops,
            class: flight.class,
            amadeusData: flight.amadeusData,
          },
          passengers,
          baggage,
          fare: selectedFare,
          insurance,
          seats,
          priceBreakdown
        },
        price: priceBreakdown.total.toString(),
        fullName: `${passengers[0].firstName} ${passengers[0].lastName}`,
        email: passengers[0].email
      };

      console.log('🚀 Sending booking request to:', `${apiBase}/travel/bookings`);
      console.log('📦 Booking data being sent:', {
        type: bookingData.type,
        hasFlight: !!bookingData.itemData?.flight,
        hasAmadeusData: !!bookingData.itemData?.flight?.amadeusData,
        hasBaggage: !!bookingData.itemData?.baggage,
        baggageWeight: bookingData.itemData?.baggage?.checkedWeight,
        passengers: bookingData.itemData?.passengers?.length,
        price: bookingData.price
      });
      
      const response = await fetch(`${apiBase}/travel/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(bookingData)
      });
      
      console.log('📡 Booking response status:', response.status, response.statusText);
      
      if (!response.ok) {
        if (response.status === 401) {
          console.error('❌ Authentication failed - token expired or invalid');
          setLoading(false);
          setError('Your session has expired. Please log in again to complete your booking.');
          setTimeout(() => {
            const redirectParam = encodeURIComponent(window.location.pathname + window.location.search);
            router.push(`/auth/login?redirect=${redirectParam}`);
          }, 2000);
          return;
        }
        
        const errorData = await response.json().catch(() => ({ message: 'Booking failed' }));
        const errorMessage = errorData.message || errorData.error || 'Failed to create booking';
        throw new Error(errorMessage);
      }
      
      const booking = await response.json();
      console.log('✅ Booking created successfully:', booking);
      console.log('📋 Booking details:', { 
        id: booking.id, 
        type: booking.type, 
        status: booking.status,
        amadeusOrderId: booking.amadeusOrderId,
        amadeusBookingReference: booking.amadeusBookingReference,
        isTicketed: booking.isTicketed,
        hasFlight: !!booking.data?.flight || !!booking.itemData?.flight 
      });
      
      if (!booking.amadeusOrderId) {
        console.error('⚠️ WARNING: Booking created but no Amadeus order ID found!');
        throw new Error('Booking was created but failed to process through Amadeus. Please contact support.');
      }
      
      setBookingId(booking.id);
      setBookingSuccess(booking);
      
      await checkAuth();
    } catch (err: any) {
      console.error('Booking error:', err);
      
      if (err.message?.includes('fetch') || err.message?.includes('Failed to fetch') || err.name === 'TypeError') {
        setError('Network error: Cannot connect to server. Please check your internet connection and ensure the backend is running.');
      } else if (err.message) {
        setError(err.message || 'Failed to create booking. Please try again.');
      } else {
        setError('Failed to create booking. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setError(null);
    const stepOrder: BookingStep[] = ['passengers', 'baggage', 'fare', 'seating', 'payment'];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(stepOrder[currentIndex - 1]);
    }
  };

  const addPassenger = () => {
    setPassengers([...passengers, {
      title: 'Mr',
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      nationality: '',
      passportNumber: '',
      passportExpiry: '',
      email: '',
      phone: ''
    }]);
  };

  const removePassenger = (index: number) => {
    if (passengers.length > 1) {
      setPassengers(passengers.filter((_, i) => i !== index));
    }
  };

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = matches && matches[0] || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    if (parts.length) {
      return parts.join(' ');
    } else {
      return v;
    }
  };

  const formatExpiryDate = (value: string) => {
    const v = value.replace(/\D/g, '');
    if (v.length >= 2) {
      return v.substring(0, 2) + '/' + v.substring(2, 4);
    }
    return v;
  };

  const currentStepIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 overflow-y-auto">
      <div className="min-h-screen">
        <div className="bg-white border-b sticky top-0 z-10 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                  {flight.departure.code} → {flight.arrival.code}
                </h2>
                <p className="text-sm text-gray-600 mt-1" style={{ fontFamily: 'Inter' }}>
                  {flight.airline} • {flight.duration} • {flight.stops === 0 ? 'Nonstop' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`}
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white border-b shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center justify-between gap-2" style={{ overflow: 'hidden' }}>
              {steps.map((step, index) => {
                const isActive = step.id === currentStep;
                const isCompleted = currentStepIndex > index;
                const isUpcoming = currentStepIndex < index;

                return (
                  <div key={step.id} className="flex items-center flex-shrink-0 flex-1 min-w-0">
                    <div className="flex items-center min-w-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 flex-shrink-0 ${
                        isActive 
                          ? 'bg-[#0B1A33] text-white shadow-lg scale-110' 
                          : isCompleted 
                          ? 'bg-green-600 text-white shadow-md' 
                          : 'bg-gray-200 text-gray-500'
                      }`}>
                        {isCompleted ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          step.number
                        )}
                      </div>
                      <span className={`ml-3 text-sm font-semibold transition-colors hidden sm:block truncate ${
                        isActive 
                          ? 'text-[#0B1A33]' 
                          : isCompleted 
                          ? 'text-gray-700' 
                          : 'text-gray-500'
                      }`} style={{ fontFamily: 'Inter' }}>
                        {step.label}
                      </span>
                    </div>
                    
                    {index < steps.length - 1 && (
                      <div className={`flex-1 h-1 mx-2 rounded-full transition-all duration-300 flex-shrink-0 ${
                        isCompleted || isActive 
                          ? 'bg-green-600' 
                          : 'bg-gray-200'
                      }`} style={{ minWidth: '20px', maxWidth: '60px' }}></div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {error && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg" style={{ fontFamily: 'Inter' }}>
              {error}
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              {isSearchStale() && !priceValidatedAt && (
                <div className="mb-6 bg-yellow-50 border border-yellow-300 rounded-lg p-4">
                  <div className="flex gap-3 items-start">
                    <svg className="w-6 h-6 text-yellow-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-yellow-900 mb-1">⚠️ Search Results May Be Outdated</p>
                      <p className="text-sm text-yellow-800 mb-3">
                        This flight was searched {getSearchAgeMinutes()} minutes ago. Prices and availability may have changed. 
                        We recommend refreshing the price before booking to ensure availability.
                      </p>
                      <button
                        onClick={refreshPrice}
                        disabled={refreshingPrice}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-400 text-white rounded-lg font-medium text-sm transition-colors shadow-sm"
                      >
                        {refreshingPrice ? (
                          <>
                            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Refreshing Price...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh Price & Continue
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {priceValidatedAt && validatedPrice !== null && (
                <div className="mb-6 bg-green-50 border border-green-300 rounded-lg p-4">
                  <div className="flex gap-3">
                    <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-green-900">✓ Price Confirmed</p>
                      <p className="text-sm text-green-800">
                        Flight is available at ${validatedPrice.toFixed(2)}. This price is guaranteed for your booking.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl border p-6 mb-6" style={{ borderColor: '#E5E7EB' }}>
                <h3 className="text-lg font-semibold mb-4" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                  Trip Summary
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium" style={{ color: '#0B1A33', fontFamily: 'Inter' }}>
                        {flight.departure.time} • {flight.departure.code}
                      </p>
                      <p className="text-sm text-gray-600" style={{ fontFamily: 'Inter' }}>
                        {flight.departure.airport}
                      </p>
                      <p className="text-xs text-gray-500 mt-1" style={{ fontFamily: 'Inter' }}>
                        {new Date(flight.departure.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
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
                    <div className="text-right">
                      <p className="font-medium" style={{ color: '#0B1A33', fontFamily: 'Inter' }}>
                        {flight.arrival.time} • {flight.arrival.code}
                      </p>
                      <p className="text-sm text-gray-600" style={{ fontFamily: 'Inter' }}>
                        {flight.arrival.airport}
                      </p>
                      <p className="text-xs text-gray-500 mt-1" style={{ fontFamily: 'Inter' }}>
                        {new Date(flight.arrival.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {currentStep === 'passengers' && (
                <div className="bg-white rounded-xl border p-6" style={{ borderColor: '#E5E7EB' }}>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-semibold" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                      Passenger Information
                    </h3>
                    <button
                      onClick={addPassenger}
                      className="text-sm text-[#0B1A33] hover:underline font-medium"
                      style={{ fontFamily: 'Inter' }}
                    >
                      + Add Passenger
                    </button>
                  </div>
                  
                  {passengers.map((passenger, index) => (
                    <div key={index} className="mb-6 pb-6 border-b last:border-b-0" style={{ borderColor: '#E5E7EB' }}>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-medium" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                          Passenger {index + 1}
                        </h4>
                        {passengers.length > 1 && (
                          <button
                            onClick={() => removePassenger(index)}
                            className="text-sm text-red-600 hover:underline"
                            style={{ fontFamily: 'Inter' }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Title *</label>
                          <select
                            value={passenger.title}
                            onChange={(e) => {
                              const updated = [...passengers];
                              updated[index].title = e.target.value;
                              setPassengers(updated);
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                            required
                          >
                            <option>Mr</option>
                            <option>Mrs</option>
                            <option>Ms</option>
                            <option>Miss</option>
                            <option>Dr</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>First Name *</label>
                          <input
                            type="text"
                            value={passenger.firstName}
                            onChange={(e) => {
                              const updated = [...passengers];
                              updated[index].firstName = e.target.value;
                              setPassengers(updated);
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Last Name *</label>
                          <input
                            type="text"
                            value={passenger.lastName}
                            onChange={(e) => {
                              const updated = [...passengers];
                              updated[index].lastName = e.target.value;
                              setPassengers(updated);
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Date of Birth *</label>
                          <input
                            type="date"
                            value={passenger.dateOfBirth}
                            onChange={(e) => {
                              const updated = [...passengers];
                              updated[index].dateOfBirth = e.target.value;
                              setPassengers(updated);
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Nationality *</label>
                          <input
                            type="text"
                            value={passenger.nationality}
                            onChange={(e) => {
                              const updated = [...passengers];
                              updated[index].nationality = e.target.value;
                              setPassengers(updated);
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                            placeholder="e.g., US, UK, CA"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Passport Number</label>
                          <input
                            type="text"
                            value={passenger.passportNumber}
                            onChange={(e) => {
                              const updated = [...passengers];
                              updated[index].passportNumber = e.target.value;
                              setPassengers(updated);
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Passport Expiry</label>
                          <input
                            type="date"
                            value={passenger.passportExpiry}
                            onChange={(e) => {
                              const updated = [...passengers];
                              updated[index].passportExpiry = e.target.value;
                              setPassengers(updated);
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Email Address *</label>
                          <input
                            type="email"
                            value={passenger.email}
                            onChange={(e) => {
                              const updated = [...passengers];
                              updated[index].email = e.target.value;
                              setPassengers(updated);
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                            placeholder="your@email.com"
                            required
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Phone Number</label>
                          <input
                            type="tel"
                            value={passenger.phone || ''}
                            onChange={(e) => {
                              const updated = [...passengers];
                              updated[index].phone = e.target.value;
                              setPassengers(updated);
                            }}
                            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                            placeholder="+1 (555) 123-4567"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {currentStep === 'baggage' && (
                <div className="bg-white rounded-xl border p-6" style={{ borderColor: '#E5E7EB' }}>
                  <h3 className="text-xl font-semibold mb-6" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                    Baggage & Insurance
                  </h3>
                  
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-medium mb-4" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                        Baggage Options
                      </h4>
                      <div className="space-y-3">
                        <label className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50" style={{ borderColor: '#E5E7EB' }}>
                          <input
                            type="checkbox"
                            checked={baggage.cabin}
                            onChange={(e) => setBaggage({ ...baggage, cabin: e.target.checked })}
                            className="mr-3 w-5 h-5"
                            disabled
                          />
                          <div className="flex-1">
                            <span className="font-medium" style={{ fontFamily: 'Inter' }}>Cabin baggage</span>
                            <p className="text-sm text-gray-600" style={{ fontFamily: 'Inter' }}>Included (1 piece, up to 8kg)</p>
                          </div>
                          <span className="text-sm font-semibold text-green-600" style={{ fontFamily: 'Inter' }}>Free</span>
                        </label>
                        <label className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50" style={{ borderColor: '#E5E7EB' }}>
                          <input
                            type="checkbox"
                            checked={baggage.checked}
                            onChange={(e) => setBaggage({ ...baggage, checked: e.target.checked })}
                            className="mr-3 w-5 h-5"
                          />
                          <div className="flex-1">
                            <span className="font-medium" style={{ fontFamily: 'Inter' }}>Checked baggage</span>
                            <p className="text-sm text-gray-600" style={{ fontFamily: 'Inter' }}>Add checked baggage to your booking</p>
                          </div>
                        </label>
                        {baggage.checked && (
                          <div className="ml-8 mt-2">
                            <select
                              value={baggage.checkedWeight}
                              onChange={(e) => setBaggage({ ...baggage, checkedWeight: parseInt(e.target.value) })}
                              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                              style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                            >
                              <option value={0}>Select weight</option>
                              <option value={15}>15 kg - ${(15 * 15).toFixed(0)} ($15/kg)</option>
                              <option value={20}>20 kg - ${(20 * 15).toFixed(0)} ($15/kg)</option>
                              <option value={25}>25 kg - ${(25 * 15).toFixed(0)} ($15/kg)</option>
                              <option value={30}>30 kg - ${(30 * 15).toFixed(0)} ($15/kg)</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium mb-4" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                        Travel Insurance
                      </h4>
                      <label className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50" style={{ borderColor: '#E5E7EB' }}>
                        <input
                          type="checkbox"
                          checked={insurance}
                          onChange={(e) => setInsurance(e.target.checked)}
                          className="mr-3 w-5 h-5"
                        />
                        <div className="flex-1">
                          <span className="font-medium" style={{ fontFamily: 'Inter' }}>Add travel insurance</span>
                          <p className="text-sm text-gray-600" style={{ fontFamily: 'Inter' }}>Protect your trip with comprehensive travel insurance</p>
                        </div>
                        <span className="text-sm font-semibold" style={{ fontFamily: 'Inter' }}>+$25</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 'fare' && (
                <div className="bg-white rounded-xl border p-6" style={{ borderColor: '#E5E7EB' }}>
                  <h3 className="text-xl font-semibold mb-6" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                    Select Fare Type
                  </h3>
                  <div className="space-y-4">
                    {[
                      { id: 'saver', name: 'Saver', price: 0, features: ['Basic seat', 'Cabin baggage included', 'No changes allowed', 'No refunds'] },
                      { id: 'standard', name: 'Standard', price: 20, features: ['Standard seat', 'Cabin baggage included', '1 free change', 'Partial refunds'] },
                      { id: 'flexible', name: 'Flexible', price: 50, features: ['Preferred seat', 'Cabin baggage included', 'Unlimited changes', 'Full refunds', 'Priority boarding'] }
                    ].map((fare) => (
                      <label
                        key={fare.id}
                        className={`block p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          selectedFare === fare.id ? 'border-[#0B1A33] bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center">
                              <input
                                type="radio"
                                name="fare"
                                value={fare.id}
                                checked={selectedFare === fare.id}
                                onChange={(e) => setSelectedFare(e.target.value as any)}
                                className="mr-3"
                              />
                              <span className="font-semibold text-lg" style={{ fontFamily: 'Raleway' }}>{fare.name}</span>
                              {fare.price > 0 && (
                                <span className="ml-2 text-sm text-gray-600" style={{ fontFamily: 'Inter' }}>
                                  +${fare.price}
                                </span>
                              )}
                            </div>
                            <ul className="mt-2 ml-6 text-sm text-gray-600 space-y-1" style={{ fontFamily: 'Inter' }}>
                              {fare.features.map((feature, idx) => (
                                <li key={idx}>• {feature}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {currentStep === 'seating' && (
                <div className="bg-white rounded-xl border p-6" style={{ borderColor: '#E5E7EB' }}>
                  <h3 className="text-xl font-semibold mb-6" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                    Select Seats (Optional)
                  </h3>
                  <p className="text-gray-600 mb-4" style={{ fontFamily: 'Inter' }}>
                    You can skip this step and select seats later, or choose your preferred seats now. Seat selection may incur additional fees.
                  </p>
                  <button
                    onClick={handleNext}
                    className="px-6 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                    style={{ fontFamily: 'Inter' }}
                  >
                    Skip for now
                  </button>
                </div>
              )}

              {currentStep === 'payment' && (
                <div className="bg-white rounded-xl border p-6" style={{ borderColor: '#E5E7EB' }}>
                  <h3 className="text-xl font-semibold mb-6" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                    Payment Information
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Card Number *</label>
                      <input
                        type="text"
                        value={paymentInfo.cardNumber}
                        onChange={(e) => setPaymentInfo({ ...paymentInfo, cardNumber: formatCardNumber(e.target.value) })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                        style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                        placeholder="1234 5678 9012 3456"
                        maxLength={19}
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Expiry Date *</label>
                        <input
                          type="text"
                          value={paymentInfo.expiryDate}
                          onChange={(e) => setPaymentInfo({ ...paymentInfo, expiryDate: formatExpiryDate(e.target.value) })}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                          style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                          placeholder="MM/YY"
                          maxLength={5}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>CVC *</label>
                        <input
                          type="text"
                          value={paymentInfo.cvc}
                          onChange={(e) => setPaymentInfo({ ...paymentInfo, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                          style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                          placeholder="123"
                          maxLength={4}
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Cardholder Name *</label>
                      <input
                        type="text"
                        value={paymentInfo.cardholderName}
                        onChange={(e) => setPaymentInfo({ ...paymentInfo, cardholderName: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                        style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                        placeholder="John Doe"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ fontFamily: 'Inter' }}>Billing Address</label>
                      <input
                        type="text"
                        value={paymentInfo.billingAddress}
                        onChange={(e) => setPaymentInfo({ ...paymentInfo, billingAddress: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent mb-2"
                        style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                        placeholder="123 Main St"
                      />
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <input
                          type="text"
                          value={paymentInfo.billingCity}
                          onChange={(e) => setPaymentInfo({ ...paymentInfo, billingCity: e.target.value })}
                          className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                          style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                          placeholder="City"
                        />
                        <input
                          type="text"
                          value={paymentInfo.billingZip}
                          onChange={(e) => setPaymentInfo({ ...paymentInfo, billingZip: e.target.value })}
                          className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                          style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                          placeholder="ZIP Code"
                        />
                      </div>
                      <input
                        type="text"
                        value={paymentInfo.billingCountry}
                        onChange={(e) => setPaymentInfo({ ...paymentInfo, billingCountry: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B1A33] focus:border-transparent"
                        style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                        placeholder="Country"
                      />
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm text-blue-800" style={{ fontFamily: 'Inter' }}>
                        🔒 Your payment information is secure and encrypted. We use industry-standard SSL encryption to protect your data.
                      </p>
                    </div>
                  </div>
                </div>
              )}


              <div className="flex justify-between mt-6">
                <button
                  onClick={currentStep === 'passengers' ? onClose : handleBack}
                  className="px-6 py-3 border rounded-lg font-medium hover:bg-gray-50 transition-colors"
                  style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                  disabled={loading}
                >
                  {currentStep === 'passengers' ? 'Cancel' : 'Back'}
                </button>
                <button
                  onClick={handleNext}
                  className="px-6 py-3 rounded-lg font-semibold text-white hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#0B1A33', fontFamily: 'Raleway' }}
                  disabled={loading}
                >
                  {loading ? 'Processing...' : currentStep === 'payment' ? 'Complete Booking' : 'Continue'}
                </button>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl border p-6 sticky top-24" style={{ borderColor: '#E5E7EB' }}>
                <h3 className="text-lg font-semibold mb-4" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                  Price Summary
                </h3>
                <div className="space-y-3 mb-4">
                  <div className="flex justify-between text-sm" style={{ fontFamily: 'Inter' }}>
                    <span>{passengers.length}x {passengers.length === 1 ? 'Passenger' : 'Passengers'}</span>
                    <span>${priceBreakdown.base.toFixed(2)}</span>
                  </div>
                  {priceBreakdown.fare > 0 && (
                    <div className="flex justify-between text-sm" style={{ fontFamily: 'Inter' }}>
                      <span>{selectedFare.charAt(0).toUpperCase() + selectedFare.slice(1)} fare</span>
                      <span>+${priceBreakdown.fare.toFixed(2)}</span>
                    </div>
                  )}
                  {baggage.cabin && (
                    <div className="flex justify-between text-sm text-gray-600" style={{ fontFamily: 'Inter' }}>
                      <span>Cabin baggage</span>
                      <span>Included</span>
                    </div>
                  )}
                  {baggage.checked && priceBreakdown.baggage > 0 && (
                    <div className="flex justify-between text-sm" style={{ fontFamily: 'Inter' }}>
                      <span>Checked baggage ({baggage.checkedWeight}kg)</span>
                      <span>+${priceBreakdown.baggage.toFixed(2)}</span>
                    </div>
                  )}
                  {insurance && (
                    <div className="flex justify-between text-sm" style={{ fontFamily: 'Inter' }}>
                      <span>Travel insurance</span>
                      <span>+${priceBreakdown.insurance.toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div className="border-t pt-4" style={{ borderColor: '#E5E7EB' }}>
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-bold" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                      Total
                    </span>
                    <span className="text-xl font-bold" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                      ${priceBreakdown.total.toFixed(2)}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-4" style={{ fontFamily: 'Inter' }}>
                  Includes all taxes, fees, and surcharges
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {bookingSuccess && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-8">
              <div className="flex justify-center mb-6">
                <div className="relative">
                  <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center shadow-lg">
                    <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="absolute -inset-2 bg-green-200 rounded-full animate-ping opacity-20"></div>
                </div>
              </div>

              <h2 className="text-3xl font-bold text-center mb-2" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                Booking Confirmed! ✈️
              </h2>
              <p className="text-center text-gray-600 mb-6" style={{ fontFamily: 'Inter' }}>
                Your flight has been successfully booked
              </p>

              <div className="bg-gray-50 rounded-xl p-6 mb-6 space-y-4" style={{ fontFamily: 'Inter' }}>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Booking ID:</span>
                  <span className="font-semibold text-gray-900">{bookingSuccess.id}</span>
                </div>
                
                {bookingSuccess.amadeusOrderId && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Amadeus Order ID:</span>
                    <span className="font-mono text-sm font-semibold text-gray-900">{bookingSuccess.amadeusOrderId.substring(0, 20)}...</span>
                  </div>
                )}
                
                {bookingSuccess.amadeusBookingReference && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Booking Reference:</span>
                    <span className="font-semibold text-gray-900">{bookingSuccess.amadeusBookingReference}</span>
                  </div>
                )}
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Status:</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    bookingSuccess.isTicketed 
                      ? 'bg-green-100 text-green-800' 
                      : bookingSuccess.amadeusTicketingStatus === 'CONFIRMED'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {bookingSuccess.isTicketed 
                      ? '✓ Ticketed' 
                      : bookingSuccess.amadeusTicketingStatus || 'Confirmed'}
                  </span>
                </div>
                
                {bookingSuccess.amadeusTickets && bookingSuccess.amadeusTickets.length > 0 && (
                  <div>
                    <span className="text-gray-600 block mb-2">Tickets Issued:</span>
                    <div className="space-y-1">
                      {bookingSuccess.amadeusTickets.map((ticket: any, idx: number) => (
                        <div key={idx} className="text-sm font-mono bg-white px-3 py-2 rounded border">
                          {ticket.reference || `Ticket ${idx + 1}`}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <span className="text-gray-600">Total Amount:</span>
                  <span className="text-2xl font-bold" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                    ${bookingSuccess.price || priceBreakdown.total.toFixed(2)}
                  </span>
                </div>
              </div>

              {!bookingSuccess.isTicketed && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <div className="flex gap-3">
                    <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-yellow-900">Tickets Processing</p>
                      <p className="text-xs text-yellow-700 mt-1">
                        Your booking is confirmed. Tickets are being processed and will be issued shortly. You'll receive an email confirmation once tickets are ready.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    setBookingSuccess(null);
                    onClose();
                    setTimeout(() => {
                      window.location.href = '/profile/bookings';
                    }, 300);
                  }}
                  className="flex-1 px-6 py-3 rounded-lg font-semibold text-white hover:opacity-90 transition-all"
                  style={{ backgroundColor: '#0B1A33', fontFamily: 'Raleway' }}
                >
                  View My Bookings
                </button>
                <button
                  onClick={() => {
                    setBookingSuccess(null);
                    onClose();
                  }}
                  className="px-6 py-3 border rounded-lg font-medium hover:bg-gray-50 transition-colors"
                  style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
