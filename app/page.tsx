'use client';

import { useState, useEffect } from 'react';
import Upload from '@/app/components/Upload';
import Status from '@/app/components/Status';
import Header from '@/app/components/Header';

export type AppState = 'upload' | 'processing' | 'complete' | 'error';

const STORAGE_KEY = 'handscript_active_job';

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<AppState>('upload');
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [email, setEmail] = useState<string | undefined>(undefined);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.jobId && parsed.state !== 'complete' && parsed.state !== 'upload') {
          setJobId(parsed.jobId);
          setState(parsed.state);
          setImages(parsed.images || []);
          setEmail(parsed.email);
        }
      } catch (e) {
        console.error('Failed to parse saved session', e);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (state === 'upload' || state === 'complete') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId, state, images, email }));
    }
  }, [jobId, state, images, email, isLoaded]);

  const handleJobCreated = (id: string, extractedImages: string[], userEmail?: string) => {
    setJobId(id);
    setImages(extractedImages);
    setEmail(userEmail);
    setState('processing');
  };

  const handleComplete = () => setState('complete');
  const handleError = (msg: string) => { setError(msg); setState('error'); };

  const reset = () => {
    setJobId(null);
    setImages([]);
    setEmail(undefined);
    setState('upload');
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-light">
        <div className="animate-pulse text-cool-grey">Loading...</div>
      </div>
    );
  }

  return (
    <div className="bg-background-light min-h-screen flex flex-col relative overflow-hidden bg-noise">
      {/* Background layers */}
      <div className="fixed inset-0 z-0 pointer-events-none bg-grid opacity-30"></div>
      <div className="fixed inset-0 z-0 pointer-events-none hero-wash"></div>
      <div className="fixed inset-0 z-0 pointer-events-none bg-vignette"></div>

      <Header />

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center relative z-10 pt-16 sm:pt-20 px-4 safe-area-inset">

        {state === 'upload' && (
          <div className="w-full max-w-xl flex flex-col items-center">
            {/* Hero - Compact */}
            <div className="text-center mb-4 sm:mb-6">
              <h1 className="font-display text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-slate-grey leading-tight tracking-tight mb-2 sm:mb-3">
                Transform Handwriting <span className="text-cool-grey italic font-normal">into</span> Typed Notes
              </h1>
              <p className="text-xs sm:text-sm md:text-base text-cool-grey font-light">
                Turn notes into searchable, citation-ready PDFs with 99% accuracy.
              </p>
            </div>

            {/* Upload Card */}
            <Upload onJobCreated={handleJobCreated} onError={handleError} />

            {/* Trusted Section - More Compact */}
            <div className="mt-3 sm:mt-4 w-full">
              <p className="text-center text-[7px] sm:text-[8px] font-semibold text-cool-grey/40 uppercase tracking-wider mb-1.5 sm:mb-2">Trusted by researchers at</p>
              <div className="flex flex-wrap justify-center items-center gap-3 sm:gap-4 md:gap-6 opacity-50">
                <span className="text-slate-grey font-display font-semibold text-[9px] sm:text-[10px]">Stanford</span>
                <span className="text-slate-grey font-display font-semibold text-[9px] sm:text-[10px]">Oxford</span>
                <span className="text-slate-grey font-display font-semibold text-[9px] sm:text-[10px]">MIT</span>
                <span className="text-slate-grey font-display font-semibold text-[9px] sm:text-[10px]">Harvard</span>
              </div>
            </div>
          </div>
        )}

        {(state === 'processing' || state === 'complete') && jobId && (
          <div className="w-full max-w-md">
            <Status jobId={jobId} images={images} email={email} onComplete={handleComplete} onError={handleError} onReset={reset} />
          </div>
        )}

        {state === 'error' && (
          <div className="w-full max-w-md bg-red-50 p-6 rounded-xl border border-red-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-red-600 text-xl">error</span>
              <h3 className="text-red-800 font-semibold">Something went wrong</h3>
            </div>
            <p className="text-red-600 text-sm mb-4">{error || 'Unknown error occurred'}</p>
            <button onClick={reset} className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-sm font-medium transition-colors">
              Try Again
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-4 sm:py-3 text-center safe-area-inset">
        <p className="text-[10px] sm:text-xs text-cool-grey/40 font-light tracking-wide">made by <a href="https://harshalsingh.vercel.app" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors underline underline-offset-2">HARSHAL</a></p>
      </footer>
    </div>
  );
}
