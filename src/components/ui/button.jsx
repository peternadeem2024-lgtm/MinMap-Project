import React, { forwardRef } from 'react';

const baseClasses = 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';
const variantClasses = {
  default: 'bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-500',
  secondary: 'bg-slate-200 text-slate-900 hover:bg-slate-300 focus:ring-slate-400',
  outline: 'border border-slate-300 hover:bg-slate-100 focus:ring-slate-400',
  ghost: 'hover:bg-slate-100 focus:ring-slate-300',
  destructive: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-400',
};
const sizeClasses = {
  default: 'h-10 px-4 py-2 text-sm',
  sm: 'h-8 px-3 text-xs',
  icon: 'h-8 w-8 p-0',
};

function cn(...values) {
  return values.filter(Boolean).join(' ');
}

export const Button = forwardRef(function Button(
  { className = '', variant = 'default', size = 'default', asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? 'span' : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(baseClasses, variantClasses[variant] || variantClasses.default, sizeClasses[size] || sizeClasses.default, className)}
      {...props}
    />
  );
});
