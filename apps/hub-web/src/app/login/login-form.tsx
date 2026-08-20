'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { loginAction } from '../actions/auth';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        width: '100%',
        padding: '14px',
        borderRadius: 10,
        background: pending
          ? 'rgba(170,255,0,0.4)'
          : 'linear-gradient(135deg, #aaff00, #7acc00)',
        color: '#000',
        fontSize: 13,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        border: 'none',
        cursor: pending ? 'not-allowed' : 'pointer',
        boxShadow: pending ? 'none' : '0 4px 20px rgba(170,255,0,0.35)',
        transition: 'all 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      {pending ? (
        <>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(0,0,0,0.3)',
              borderTopColor: '#000',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
              display: 'inline-block',
            }}
          />
          Signing in…
        </>
      ) : (
        <>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
          >
            login
          </span>
          Sign In
        </>
      )}
    </button>
  );
}

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await loginAction(formData);
    if (!result.success && result.error) {
      setError(result.error);
    }
  }

  const inputStyle = {
    width: '100%',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 8,
    padding: '12px 14px',
    fontSize: 13,
    color: '#eceae6',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box' as const,
  };

  const labelStyle = {
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.12em',
    color: 'rgba(229,226,225,0.45)',
    marginBottom: 7,
  };

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .cf-input:focus { border-color: rgba(170,255,0,0.5) !important; box-shadow: 0 0 0 3px rgba(170,255,0,0.08); }
        .cf-input::placeholder { color: rgba(229,226,225,0.2); }
      `}</style>

      <form action={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {error && (
          <div style={{
            background: 'rgba(255,80,80,0.08)',
            border: '1px solid rgba(255,80,80,0.25)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            color: '#ff8080',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0 }}>error</span>
            {error}
          </div>
        )}

        {/* Email */}
        <div>
          <label htmlFor="email" style={labelStyle}>Email</label>
          <input
            type="email"
            id="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="cf-input"
            style={inputStyle}
          />
        </div>

        {/* Password */}
        <div>
          <label htmlFor="password" style={labelStyle}>Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="cf-input"
              style={{ ...inputStyle, paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((p) => !p)}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'rgba(229,226,225,0.3)',
                padding: 0,
                lineHeight: 1,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                {showPassword ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
        </div>

        {/* Submit */}
        <div style={{ paddingTop: 4 }}>
          <SubmitButton />
        </div>
      </form>
    </>
  );
}
