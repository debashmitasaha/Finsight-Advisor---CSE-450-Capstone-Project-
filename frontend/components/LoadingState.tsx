import React from 'react';
import { Loader2 } from 'lucide-react';

const LoadingState = ({ label = 'Loading' }: { label?: string }) => (
  <div className="flex min-h-[360px] items-center justify-center" role="status" aria-label={label}>
    <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
    <span className="sr-only">{label}</span>
  </div>
);

export default LoadingState;
