'use client';

import { useState, useRef, useEffect } from 'react';

interface V2SelectOption {
  value: string;
  label: string;
}

interface V2SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: V2SelectOption[];
  placeholder?: string;
  className?: string;
}

export function V2Select({ value, onChange, options, placeholder, className }: V2SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }} className={className}>
      {/* Select trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '12px 14px',
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid rgba(var(--v2-accent-rgb), ${isOpen ? '0.4' : '0.2'})`,
          borderRadius: 8,
          color: '#e5e2e1',
          fontSize: 13,
          textAlign: 'left',
          cursor: 'pointer',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          transition: 'all 0.15s ease',
        }}
      >
        <span>{selectedOption?.label || placeholder || 'Select...'}</span>
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 18,
            color: 'rgba(205,195,215,0.6)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        >
          expand_more
        </span>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'rgba(15, 15, 25, 0.98)',
            border: '1px solid rgba(var(--v2-accent-rgb), 0.3)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 1000,
            maxHeight: 300,
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              style={{
                width: '100%',
                padding: '10px 14px',
                background: option.value === value ? 'rgba(var(--v2-accent-rgb), 0.15)' : 'transparent',
                border: 'none',
                color: option.value === value ? 'var(--v2-accent)' : '#e5e2e1',
                fontSize: 13,
                textAlign: 'left',
                cursor: 'pointer',
                outline: 'none',
                transition: 'all 0.1s ease',
              }}
              onMouseEnter={(e) => {
                if (option.value !== value) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (option.value !== value) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
