import React from 'react';

export function Separator({ orientation = 'horizontal', className = '' }) {
  if (orientation === 'vertical') {
    return <div className={`w-px self-stretch bg-slate-200 ${className}`} />;
  }
  return <div className={`h-px w-full bg-slate-200 ${className}`} />;
}
