"use client";

import { useState } from "react";
import { useRoleContext } from "./RoleContext";

interface HotelBookingFlowProps {
  hotel: any;
  room: any;
  searchParams: {
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    rooms: number;
    nights: number;
  };
  onClose: () => void;
  onComplete: (bookingData: any) => Promise<void>;
}

type BookingStep = 'guest-info' | 'review' | 'payment' | 'success';

export default function HotelBookingFlow({ hotel, room, searchParams, onClose, onComplete }: HotelBookingFlowProps) {
  const { isAuthenticated, authChecked } = useRoleContext();
  const [currentStep, setCurrentStep] = useState<BookingStep>('guest-info');
  const [isProcessing, setIsProcessing] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [guestInfo, setGuestInfo] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialRequests: '',
  });
  const [paymentInfo, setPaymentInfo] = useState({
    cardNumber: '',
    expiryDate: '',
    cvc: '',
    cardholderName: '',
  });

  const steps = [
    { id: 'guest-info', label: 'Your Details', number: 1, icon: '👤' },
    { id: 'review', label: 'Confirm Booking', number: 2, icon: '✓' },
    { id: 'payment', label: 'Secure Payment', number: 3, icon: '🔒' },
    { id: 'success', label: 'Confirmed', number: 4, icon: '✅' },
  ];

  const calculateTotal = () => {
    const basePrice = room.price * searchParams.nights * searchParams.rooms;
    const taxes = Math.round(basePrice * 0.15);
    return {
      base: basePrice,
      taxes: taxes,
      total: basePrice + taxes,
    };
  };

  const { base, taxes, total } = calculateTotal();

  const validateGuestInfo = () => {
    const newErrors: Record<string, string> = {};
    if (!guestInfo.firstName.trim()) newErrors.firstName = 'First name is required';
    if (!guestInfo.lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!guestInfo.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestInfo.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    if (!guestInfo.phone.trim()) {
      newErrors.phone = 'Phone number is required';
    } else if (!/^[\d\s\-\+\(\)]+$/.test(guestInfo.phone)) {
      newErrors.phone = 'Please enter a valid phone number';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validatePaymentInfo = () => {
    const newErrors: Record<string, string> = {};
    if (!paymentInfo.cardholderName.trim()) newErrors.cardholderName = 'Cardholder name is required';
    if (!paymentInfo.cardNumber.replace(/\s/g, '')) {
      newErrors.cardNumber = 'Card number is required';
    } else if (paymentInfo.cardNumber.replace(/\s/g, '').length < 13) {
      newErrors.cardNumber = 'Card number must be at least 13 digits';
    }
    if (!paymentInfo.expiryDate) {
      newErrors.expiryDate = 'Expiry date is required';
    } else {
      const [month, year] = paymentInfo.expiryDate.split('/');
      const expiry = new Date(2000 + parseInt(year), parseInt(month) - 1);
      if (expiry < new Date()) {
        newErrors.expiryDate = 'Card has expired';
      }
    }
    if (!paymentInfo.cvc) {
      newErrors.cvc = 'CVC is required';
    } else if (paymentInfo.cvc.length < 3) {
      newErrors.cvc = 'CVC must be at least 3 digits';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (currentStep === 'guest-info') {
      if (!validateGuestInfo()) return;
      setCurrentStep('review');
    } else if (currentStep === 'review') {
      if (!isAuthenticated) {
        const bookingData = {
          hotel,
          room,
          searchParams,
          guestInfo,
          total,
        };
        sessionStorage.setItem('pendingHotelBooking', JSON.stringify(bookingData));
        const redirectParam = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/auth/login?redirect=${redirectParam}`;
        return;
      }
      setCurrentStep('payment');
    }
  };

  const handleBack = () => {
    if (currentStep === 'review') {
      setCurrentStep('guest-info');
    } else if (currentStep === 'payment') {
      setCurrentStep('review');
    }
  };

  const handleComplete = async () => {
    if (!validatePaymentInfo()) return;

    if (!isAuthenticated) {
      const redirectParam = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/auth/login?redirect=${redirectParam}`;
      return;
    }

    setIsProcessing(true);
    setErrors({});

    try {
      // onComplete redirects on success or throws
      await onComplete({
        hotel,
        room,
        searchParams,
        guestInfo,
        paymentInfo,
        total,
      });

      throw new Error('Booking failed: No confirmation received from Amadeus. The booking was NOT confirmed.');
    } catch (error: any) {
      console.error('❌ Booking failed - NO FAKE BOOKING:', error);
      setErrors({ 
        payment: error.message || 'Booking failed. Please check your payment information and try again.' 
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const currentStepIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 overflow-y-auto">
      <div className="min-h-screen">
        <div className="bg-gradient-to-r from-[#0B1A33] via-[#1a2d4d] to-[#0B1A33] border-b border-slate-200/20 sticky top-0 z-10 shadow-lg backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div>
                  <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Raleway' }}>
                    {hotel.name}
                  </h2>
                  <p className="text-sm text-blue-100" style={{ fontFamily: 'Inter' }}>
                    {room.name}
                  </p>
                </div>
              </div>
              <div className="hidden md:flex items-center gap-2 text-sm text-blue-100">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span style={{ fontFamily: 'Inter' }}>Secure Booking</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center justify-center gap-4 md:gap-8">
              {steps.map((step, index) => {
                const isActive = step.id === currentStep;
                const isCompleted = currentStepIndex > index;
                const isUpcoming = currentStepIndex < index;

                return (
                  <div key={step.id} className="flex items-center flex-1 max-w-[200px]">
                    <div className="flex flex-col items-center flex-1">
                      <div className="relative">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-lg transition-all duration-300 ${
                          isActive 
                            ? 'bg-gradient-to-br from-[#0B1A33] to-[#1a2d4d] text-white shadow-lg shadow-[#0B1A33]/30 scale-110' 
                            : isCompleted 
                            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md' 
                            : 'bg-slate-100 text-slate-400'
                        }`}>
                          {isCompleted ? (
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <span>{step.number}</span>
                          )}
                        </div>
                        {isActive && (
                          <div className="absolute -inset-1 bg-[#0B1A33]/20 rounded-2xl animate-pulse"></div>
                        )}
                      </div>
                      <span className={`mt-3 text-xs md:text-sm font-semibold text-center transition-colors ${
                        isActive 
                          ? 'text-[#0B1A33]' 
                          : isCompleted 
                          ? 'text-slate-600' 
                          : 'text-slate-400'
                      }`} style={{ fontFamily: 'Inter' }}>
                        {step.label}
                      </span>
                    </div>
                    {index < steps.length - 1 && (
                      <div className={`hidden md:block flex-1 h-0.5 mx-2 rounded-full transition-all duration-500 ${
                        isCompleted || isActive 
                          ? 'bg-gradient-to-r from-emerald-500 to-[#0B1A33]' 
                          : 'bg-slate-200'
                      }`}></div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              {currentStep === 'guest-info' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-slate-50 to-blue-50/50 px-6 py-5 border-b border-slate-200">
                    <h3 className="text-2xl font-bold" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                      Guest Information
                    </h3>
                    <p className="text-sm text-slate-600 mt-1" style={{ fontFamily: 'Inter' }}>
                      We'll use this to confirm your reservation
                    </p>
                  </div>
                  <div className="p-6 md:p-8">
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                          <label className="block text-sm font-semibold mb-2 text-slate-700" style={{ fontFamily: 'Inter' }}>
                            First Name *
                          </label>
                          <input
                            type="text"
                            value={guestInfo.firstName}
                            onChange={(e) => {
                              setGuestInfo({ ...guestInfo, firstName: e.target.value });
                              if (errors.firstName) setErrors({ ...errors, firstName: '' });
                            }}
                            className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1A33]/20 transition-all ${
                              errors.firstName ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-[#0B1A33]'
                            }`}
                            style={{ fontFamily: 'Inter' }}
                            required
                            placeholder="John"
                          />
                          {errors.firstName && (
                            <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter' }}>{errors.firstName}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-semibold mb-2 text-slate-700" style={{ fontFamily: 'Inter' }}>
                            Last Name *
                          </label>
                          <input
                            type="text"
                            value={guestInfo.lastName}
                            onChange={(e) => setGuestInfo({ ...guestInfo, lastName: e.target.value })}
                            className="w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1A33]/20 focus:border-[#0B1A33] transition-all"
                            style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                            required
                            placeholder="Doe"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold mb-2 text-slate-700" style={{ fontFamily: 'Inter' }}>
                          Email Address *
                        </label>
                        <input
                          type="email"
                          value={guestInfo.email}
                          onChange={(e) => setGuestInfo({ ...guestInfo, email: e.target.value })}
                          className="w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1A33]/20 focus:border-[#0B1A33] transition-all"
                          style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                          required
                          placeholder="john.doe@example.com"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold mb-2 text-slate-700" style={{ fontFamily: 'Inter' }}>
                          Phone Number *
                        </label>
                        <input
                          type="tel"
                          value={guestInfo.phone}
                          onChange={(e) => setGuestInfo({ ...guestInfo, phone: e.target.value })}
                          className="w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1A33]/20 focus:border-[#0B1A33] transition-all"
                          style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                          required
                          placeholder="+1 (555) 123-4567"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold mb-2 text-slate-700" style={{ fontFamily: 'Inter' }}>
                          Special Requests (Optional)
                        </label>
                        <textarea
                          value={guestInfo.specialRequests}
                          onChange={(e) => setGuestInfo({ ...guestInfo, specialRequests: e.target.value })}
                          className="w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1A33]/20 focus:border-[#0B1A33] transition-all resize-none"
                          style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                          rows={4}
                          placeholder="Any special requests or preferences for your stay..."
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 'review' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-slate-50 to-blue-50/50 px-6 py-5 border-b border-slate-200">
                    <h3 className="text-2xl font-bold" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                      Review Your Booking
                    </h3>
                    <p className="text-sm text-slate-600 mt-1" style={{ fontFamily: 'Inter' }}>
                      Please review all details before proceeding
                    </p>
                  </div>
                  <div className="p-6 md:p-8 space-y-6">
                    <div className="bg-gradient-to-br from-slate-50 to-blue-50/30 rounded-xl p-5 border border-slate-200">
                      <h4 className="font-bold text-lg mb-4 text-slate-800" style={{ fontFamily: 'Raleway' }}>
                        Accommodation Details
                      </h4>
                      <div className="space-y-3">
                        <div>
                          <p className="font-semibold text-slate-900 mb-1" style={{ fontFamily: 'Raleway' }}>{hotel.name}</p>
                          <p className="text-sm text-slate-600" style={{ fontFamily: 'Inter' }}>{hotel.location}</p>
                        </div>
                        <div className="pt-3 border-t border-slate-200">
                          <p className="font-semibold text-slate-900 mb-1" style={{ fontFamily: 'Raleway' }}>{room.name}</p>
                          <p className="text-sm text-slate-600" style={{ fontFamily: 'Inter' }}>
                            {searchParams.checkIn} - {searchParams.checkOut} · {searchParams.nights} {searchParams.nights === 1 ? 'night' : 'nights'}
                          </p>
                          <p className="text-sm text-slate-600 mt-1" style={{ fontFamily: 'Inter' }}>
                            {searchParams.adults} {searchParams.adults === 1 ? 'adult' : 'adults'} {searchParams.children > 0 && `· ${searchParams.children} ${searchParams.children === 1 ? 'child' : 'children'}`} · {searchParams.rooms} {searchParams.rooms === 1 ? 'room' : 'rooms'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                      <h4 className="font-bold text-lg mb-4 text-slate-800" style={{ fontFamily: 'Raleway' }}>
                        Guest Information
                      </h4>
                      <div className="space-y-2">
                        <p className="text-slate-900 font-medium" style={{ fontFamily: 'Inter' }}>{guestInfo.firstName} {guestInfo.lastName}</p>
                        <p className="text-sm text-slate-600" style={{ fontFamily: 'Inter' }}>{guestInfo.email}</p>
                        <p className="text-sm text-slate-600" style={{ fontFamily: 'Inter' }}>{guestInfo.phone}</p>
                      </div>
                    </div>

                    <div className="bg-emerald-50/50 rounded-xl p-5 border border-emerald-200">
                      <h4 className="font-bold text-lg mb-3 text-slate-800" style={{ fontFamily: 'Raleway' }}>
                        Booking Policies
                      </h4>
                      <div className="space-y-2 text-sm" style={{ fontFamily: 'Inter' }}>
                        {(() => {
                          const hasFreeCancellation = 
                            (hotel?.policies?.cancellation === 'free') ||
                            (hotel?.cancellation === 'Free cancellation') ||
                            (hotel?.cancellation?.toLowerCase?.()?.includes('free')) ||
                            (room?.cancellationPolicy?.toLowerCase?.()?.includes('free'));
                          
                          return hasFreeCancellation ? (
                            <p className="text-emerald-700 flex items-center gap-2">
                              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Free cancellation available
                            </p>
                          ) : null;
                        })()}
                        {(!hotel?.policies?.prepayment && hotel?.policies?.prepayment !== true) && (
                          <p className="text-emerald-700 flex items-center gap-2">
                            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            No prepayment required
                          </p>
                        )}
                        <p className="text-slate-600 flex items-center gap-2">
                          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Instant confirmation
                        </p>
                        <p className="text-slate-600 flex items-center gap-2">
                          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                          Secure booking with SSL encryption
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 'payment' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-slate-50 to-blue-50/50 px-6 py-5 border-b border-slate-200">
                    <h3 className="text-2xl font-bold" style={{ color: '#0B1A33', fontFamily: 'Raleway' }}>
                      Payment Information
                    </h3>
                    <p className="text-sm text-slate-600 mt-1" style={{ fontFamily: 'Inter' }}>
                      Your payment is secured with 256-bit encryption
                    </p>
                  </div>
                  <div className="p-6 md:p-8">
                    {errors.payment && (
                      <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl">
                        <p className="text-red-700 text-sm" style={{ fontFamily: 'Inter' }}>{errors.payment}</p>
                      </div>
                    )}
                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-semibold mb-2 text-slate-700" style={{ fontFamily: 'Inter' }}>
                          Cardholder Name *
                        </label>
                        <input
                          type="text"
                          value={paymentInfo.cardholderName}
                          onChange={(e) => {
                            setPaymentInfo({ ...paymentInfo, cardholderName: e.target.value });
                            if (errors.cardholderName) setErrors({ ...errors, cardholderName: '' });
                          }}
                          className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1A33]/20 transition-all ${
                            errors.cardholderName ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-[#0B1A33]'
                          }`}
                          style={{ fontFamily: 'Inter' }}
                          required
                          placeholder="John Doe"
                        />
                        {errors.cardholderName && (
                          <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter' }}>{errors.cardholderName}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-semibold mb-2 text-slate-700" style={{ fontFamily: 'Inter' }}>
                          Card Number *
                        </label>
                        <input
                          type="text"
                          value={paymentInfo.cardNumber}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\s/g, '').replace(/\D/g, '');
                            const formatted = value.match(/.{1,4}/g)?.join(' ') || value;
                            setPaymentInfo({ ...paymentInfo, cardNumber: formatted });
                            if (errors.cardNumber) setErrors({ ...errors, cardNumber: '' });
                          }}
                          className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1A33]/20 transition-all ${
                            errors.cardNumber ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-[#0B1A33]'
                          }`}
                          style={{ fontFamily: 'Inter' }}
                          maxLength={19}
                          placeholder="1234 5678 9012 3456"
                          required
                        />
                        {errors.cardNumber && (
                          <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter' }}>{errors.cardNumber}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-5">
                        <div>
                          <label className="block text-sm font-semibold mb-2 text-slate-700" style={{ fontFamily: 'Inter' }}>
                            Expiry Date *
                          </label>
                          <input
                            type="text"
                            value={paymentInfo.expiryDate}
                            onChange={(e) => {
                              let value = e.target.value.replace(/\D/g, '');
                              if (value.length >= 2) {
                                value = value.slice(0, 2) + '/' + value.slice(2, 4);
                              }
                              setPaymentInfo({ ...paymentInfo, expiryDate: value });
                              if (errors.expiryDate) setErrors({ ...errors, expiryDate: '' });
                            }}
                            className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1A33]/20 transition-all ${
                              errors.expiryDate ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-[#0B1A33]'
                            }`}
                            style={{ fontFamily: 'Inter' }}
                            maxLength={5}
                            placeholder="MM/YY"
                            required
                          />
                          {errors.expiryDate && (
                            <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter' }}>{errors.expiryDate}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-semibold mb-2 text-slate-700" style={{ fontFamily: 'Inter' }}>
                            CVC *
                          </label>
                          <input
                            type="text"
                            value={paymentInfo.cvc}
                            onChange={(e) => {
                              setPaymentInfo({ ...paymentInfo, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) });
                              if (errors.cvc) setErrors({ ...errors, cvc: '' });
                            }}
                            className={`w-full px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1A33]/20 transition-all ${
                              errors.cvc ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-[#0B1A33]'
                            }`}
                            style={{ fontFamily: 'Inter' }}
                            maxLength={4}
                            placeholder="123"
                            required
                          />
                          {errors.cvc && (
                            <p className="text-red-500 text-xs mt-1" style={{ fontFamily: 'Inter' }}>{errors.cvc}</p>
                          )}
                        </div>
                      </div>
                      <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-200 mt-4">
                        <div className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          <div>
                            <p className="text-sm font-medium text-blue-900" style={{ fontFamily: 'Inter' }}>Secure Payment</p>
                            <p className="text-xs text-blue-700 mt-1" style={{ fontFamily: 'Inter' }}>Your payment information is encrypted and secure.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 'success' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
                  <div className="p-8 md:p-12 text-center">
                    <div className="mb-6 flex justify-center">
                      <div className="relative">
                        <div className="w-24 h-24 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full flex items-center justify-center shadow-lg animate-scale-in">
                          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div className="absolute -inset-2 bg-emerald-200 rounded-full animate-ping opacity-20"></div>
                      </div>
                    </div>
                    <h3 className="text-3xl font-bold mb-3 text-slate-900" style={{ fontFamily: 'Raleway' }}>
                      Booking Confirmed!
                    </h3>
                    <p className="text-lg text-slate-600 mb-2" style={{ fontFamily: 'Inter' }}>
                      Your reservation has been successfully confirmed
                    </p>
                    {bookingId && (
                      <p className="text-sm text-slate-500 mb-8" style={{ fontFamily: 'Inter' }}>
                        Booking ID: <span className="font-mono font-semibold text-[#0B1A33]">{bookingId}</span>
                      </p>
                    )}
                    <div className="bg-gradient-to-br from-slate-50 to-blue-50/30 rounded-xl p-6 border border-slate-200 mb-8 max-w-md mx-auto">
                      <div className="space-y-3 text-left">
                        <div className="flex justify-between">
                          <span className="text-slate-600" style={{ fontFamily: 'Inter' }}>Hotel:</span>
                          <span className="font-semibold text-slate-900" style={{ fontFamily: 'Raleway' }}>{hotel.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600" style={{ fontFamily: 'Inter' }}>Room:</span>
                          <span className="font-semibold text-slate-900" style={{ fontFamily: 'Raleway' }}>{room.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600" style={{ fontFamily: 'Inter' }}>Check-in:</span>
                          <span className="font-semibold text-slate-900" style={{ fontFamily: 'Raleway' }}>{searchParams.checkIn}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600" style={{ fontFamily: 'Inter' }}>Check-out:</span>
                          <span className="font-semibold text-slate-900" style={{ fontFamily: 'Raleway' }}>{searchParams.checkOut}</span>
                        </div>
                        <div className="pt-3 border-t border-slate-200 flex justify-between">
                          <span className="text-lg font-bold text-slate-900" style={{ fontFamily: 'Raleway' }}>Total:</span>
                          <span className="text-lg font-bold bg-gradient-to-r from-[#0B1A33] to-[#1a2d4d] bg-clip-text text-transparent" style={{ fontFamily: 'Raleway' }}>
                            ${total}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-200 mb-6 max-w-md mx-auto">
                      <p className="text-sm text-blue-900" style={{ fontFamily: 'Inter' }}>
                        <strong>What's next?</strong> A confirmation email has been sent to <strong>{guestInfo.email}</strong> with all the details of your booking.
                      </p>
                    </div>
                    <button
                      onClick={onClose}
                      className="px-8 py-3 rounded-xl font-bold text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all"
                      style={{ 
                        background: 'linear-gradient(135deg, #0B1A33 0%, #1a2d4d 100%)',
                        fontFamily: 'Raleway'
                      }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}

              {currentStep !== 'success' && (
                <div className="flex justify-between items-center gap-4 pt-4">
                  <button
                    onClick={currentStep === 'guest-info' ? onClose : handleBack}
                    disabled={isProcessing}
                    className="px-6 py-3 border-2 rounded-xl font-semibold text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderColor: '#E5E7EB', fontFamily: 'Inter' }}
                  >
                    {currentStep === 'guest-info' ? 'Cancel' : 'Back'}
                  </button>
                  <button
                    onClick={currentStep === 'payment' ? handleComplete : handleNext}
                    disabled={isProcessing}
                    className="px-8 py-3 rounded-xl font-bold text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center gap-2"
                    style={{ 
                      background: 'linear-gradient(135deg, #0B1A33 0%, #1a2d4d 100%)',
                      fontFamily: 'Raleway'
                    }}
                  >
                    {isProcessing ? (
                      <>
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing...
                      </>
                    ) : (
                      currentStep === 'payment' ? 'Complete Booking' : 'Continue'
                    )}
                  </button>
                </div>
              )}
            </div>

            {currentStep !== 'success' && (
              <div className="lg:col-span-1">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 sticky top-32">
                  <h3 className="text-xl font-bold mb-6 text-slate-900" style={{ fontFamily: 'Raleway' }}>
                    Booking Summary
                  </h3>
                  <div className="space-y-4 mb-6">
                    <div className="pb-4 border-b border-slate-200">
                      <p className="text-sm font-semibold text-slate-700 mb-1" style={{ fontFamily: 'Inter' }}>{room.name}</p>
                      <p className="text-xs text-slate-500" style={{ fontFamily: 'Inter' }}>${room.price} per night</p>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between text-slate-600" style={{ fontFamily: 'Inter' }}>
                        <span>{searchParams.nights} {searchParams.nights === 1 ? 'night' : 'nights'} × {searchParams.rooms} {searchParams.rooms === 1 ? 'room' : 'rooms'}</span>
                        <span className="font-medium">${base}</span>
                      </div>
                      <div className="flex justify-between text-slate-600" style={{ fontFamily: 'Inter' }}>
                        <span>Taxes & fees</span>
                        <span className="font-medium">${taxes}</span>
                      </div>
                    </div>
                  </div>
                  <div className="pt-4 border-t-2 border-slate-300">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-bold text-slate-900" style={{ fontFamily: 'Raleway' }}>
                        Total
                      </span>
                      <span className="text-2xl font-bold bg-gradient-to-r from-[#0B1A33] to-[#1a2d4d] bg-clip-text text-transparent" style={{ fontFamily: 'Raleway' }}>
                        ${total}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-4 text-center" style={{ fontFamily: 'Inter' }}>
                    All prices include taxes and fees
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
