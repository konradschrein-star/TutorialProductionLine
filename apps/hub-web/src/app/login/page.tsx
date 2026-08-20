import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect('/');

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&family=Inter:wght@300;400;500;600;700;800;900&display=swap"
        rel="stylesheet"
      />

      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, sans-serif',
          padding: 16,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Video Background */}
        <video
          autoPlay
          loop
          muted
          playsInline
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0,
          }}
        >
          <source src="/login-bg.mp4" type="video/mp4" />
        </video>

        {/* Dark overlay for better text readability */}
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.6))',
          zIndex: 1,
          pointerEvents: 'none',
        }} />

        {/* Accent glow blobs */}
        <div style={{
          position: 'fixed', top: 0, right: 0, pointerEvents: 'none', zIndex: 2,
          width: 700, height: 700,
          background: 'rgba(170,255,0,0.08)',
          filter: 'blur(120px)', borderRadius: '50%',
          transform: 'translate(40%, -40%)',
        }} />
        <div style={{
          position: 'fixed', bottom: 0, left: 0, pointerEvents: 'none', zIndex: 2,
          width: 500, height: 500,
          background: 'rgba(170,255,0,0.05)',
          filter: 'blur(100px)', borderRadius: '50%',
          transform: 'translate(-40%, 40%)',
        }} />

        <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 10 }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'linear-gradient(135deg, #aaff00, #7acc00)',
              boxShadow: '0 0 30px rgba(170,255,0,0.35)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 26, color: '#000', fontVariationSettings: "'FILL' 1" }}
              >
                bolt
              </span>
            </div>
            <h1 style={{ color: '#eceae6', fontSize: 24, fontWeight: 900, letterSpacing: '-0.02em', marginBottom: 5 }}>
              Content Forge
            </h1>
            <p style={{ color: 'rgba(229,226,225,0.35)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
              Hub Control Plane
            </p>
          </div>

          {/* Card */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 16,
            padding: 32,
            backdropFilter: 'blur(20px)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <h2 style={{ color: '#eceae6', fontSize: 18, fontWeight: 800, marginBottom: 24, letterSpacing: '-0.01em' }}>
              Sign in to your account
            </h2>
            <LoginForm />
          </div>

          <p style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'rgba(229,226,225,0.2)' }}>
            YouTube Automation Engine · v0.1.0
          </p>
        </div>
      </div>
    </>
  );
}
