import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

const DropdownContext = createContext(null);

export function DropdownMenu({ children }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <DropdownContext.Provider value={{ open, setOpen, menuRef }}>
      <div ref={menuRef} className="relative inline-block">
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

function useDropdownContext() {
  const ctx = useContext(DropdownContext);
  if (!ctx) {
    throw new Error('Dropdown components must be used within <DropdownMenu>.');
  }
  return ctx;
}

export function DropdownMenuTrigger({ asChild = false, children }) {
  const { setOpen } = useDropdownContext();

  const handleClick = (event) => {
    event.preventDefault();
    setOpen((prev) => !prev);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      onClick: (event) => {
        children.props.onClick?.(event);
        handleClick(event);
      },
    });
  }

  return (
    <button type="button" onClick={handleClick} className="inline-flex items-center">
      {children}
    </button>
  );
}

export function DropdownMenuContent({ children, align = 'start', className = '' }) {
  const { open } = useDropdownContext();

  if (!open) return null;

  const alignmentClass = align === 'end' ? 'right-0' : 'left-0';

  return (
    <div
      className={`absolute z-50 mt-2 min-w-[200px] rounded-md border border-slate-200 bg-white p-1 shadow-lg ${alignmentClass} ${className}`}
      role="menu"
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({ children, className = '', onClick }) {
  const { setOpen } = useDropdownContext();

  const handleSelect = (event) => {
    onClick?.(event);
    setOpen(false);
  };

  return (
    <button
      type="button"
      onClick={handleSelect}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-slate-100 ${className}`}
      role="menuitem"
    >
      {children}
    </button>
  );
}

export function DropdownMenuLabel({ children, className = '' }) {
  return <div className={`px-2 py-1 text-xs font-semibold uppercase text-slate-500 ${className}`}>{children}</div>;
}

export function DropdownMenuSeparator({ className = '' }) {
  return <div className={`my-1 h-px bg-slate-200 ${className}`} role="separator" />;
}
