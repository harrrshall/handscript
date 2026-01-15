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

  // Load from localStorage on mount
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

  // Save to localStorage on change
  useEffect(() => {
    if (!isLoaded) return;

    if (state === 'upload' || state === 'complete') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        jobId,
        state,
        images,
        email
      }));
    }
  }, [jobId, state, images, email, isLoaded]);

  const handleJobCreated = (id: string, extractedImages: string[], userEmail?: string) => {
    setJobId(id);
    setImages(extractedImages);
    setEmail(userEmail);
    setState('processing');
  };

  const handleComplete = () => {
    setState('complete');
  };

  const handleError = (msg: string) => {
    setError(msg);
    setState('error');
  };

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
      <div className="min-h-screen p-8 pb-20 sm:p-20 font-[family-name:var(--font-geist-sans)] flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading HandScript...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 pb-20 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <Header />
      <main className="flex flex-col gap-8 items-center sm:items-start max-w-2xl mx-auto w-full">

        {state === 'upload' && (
          <div className="w-full">
            <div className="mb-8 text-center sm:text-left">
              <h2 className="text-2xl font-bold tracking-tight">Convert Notes to PDF</h2>
              <p className="text-gray-500 dark:text-gray-400 mt-2">
                Upload your handwritten notes and let our AI convert them into clean,
                formatted engineering/academic documents.
              </p>
            </div>
            <Upload onJobCreated={handleJobCreated} onError={handleError} />
          </div>
        )}

        {(state === 'processing' || state === 'complete') && jobId && (
          <Status
            jobId={jobId}
            images={images}
            email={email}
            onComplete={handleComplete}
            onError={handleError}
            onReset={reset}
          />
        )}

        {state === 'error' && (
          <div className="w-full bg-red-50 dark:bg-red-900/20 p-6 rounded-lg border border-red-200 dark:border-red-800">
            <h3 className="text-red-800 dark:text-red-200 font-semibold mb-2">Something went wrong</h3>
            <p className="text-red-600 dark:text-red-300">{error || 'Unknown error occurred'}</p>
            <button
              onClick={reset}
              className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

      </main>
      <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center mt-12 text-sm text-gray-400">
        <p>© 2026 HandScript. Powered by Gemini & Typst.</p>
      </footer>
    </div>
  );
}
