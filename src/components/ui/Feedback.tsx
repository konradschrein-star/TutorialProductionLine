import React, { createContext, useContext, useCallback, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { Modal } from './Modal';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export type ToastKind = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  title?: string;
}

interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
}

interface FeedbackContextValue {
  toast: (message: string, kind?: ToastKind, title?: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const TOAST_META: Record<ToastKind, { icon: React.ReactNode; cls: string }> = {
  success: { icon: <CheckCircle2 size={18} />, cls: 'text-success' },
  error: { icon: <XCircle size={18} />, cls: 'text-danger' },
  warning: { icon: <AlertTriangle size={18} />, cls: 'text-warning' },
  info: { icon: <Info size={18} />, cls: 'text-info' },
};

let idCounter = 0;
const nextId = () => `t${Date.now()}_${idCounter++}`;

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = 'info', title?: string) => {
    const id = nextId();
    setToasts((prev) => [...prev, { id, kind, message, title }]);
    const ttl = kind === 'error' ? 6500 : 4000;
    setTimeout(() => dismiss(id), ttl);
  }, [dismiss]);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setConfirmState({ ...options, open: true });
    });
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setConfirmState((s) => (s ? { ...s, open: false } : s));
  }, []);

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      {/* Toast viewport */}
      <div className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2 w-[min(92vw,22rem)] pointer-events-none">
        {toasts.map((t) => {
          const meta = TOAST_META[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className="pro-panel rounded-lg px-3.5 py-3 flex items-start gap-3 shadow-elevation animate-toastIn pointer-events-auto"
            >
              <span className={`shrink-0 mt-0.5 ${meta.cls}`}>{meta.icon}</span>
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-sm font-semibold text-foreground">{t.title}</p>}
                <p className="text-xs text-muted leading-relaxed break-words">{t.message}</p>
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 text-muted hover:text-foreground transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirm dialog */}
      <Modal
        isOpen={!!confirmState?.open}
        onClose={() => closeConfirm(false)}
        title={confirmState?.title || 'Please confirm'}
        size="sm"
        footer={
          <>
            <button className="btn-outline focus-ring rounded-md px-3.5 py-2 text-sm" onClick={() => closeConfirm(false)}>
              {confirmState?.cancelLabel || 'Cancel'}
            </button>
            <button
              className={`focus-ring rounded-md px-3.5 py-2 text-sm font-semibold ${
                confirmState?.danger ? 'bg-danger text-white hover:opacity-90' : 'btn-accent'
              }`}
              onClick={() => closeConfirm(true)}
            >
              {confirmState?.confirmLabel || 'Confirm'}
            </button>
          </>
        }
      >
        <div className="text-sm text-muted leading-relaxed">{confirmState?.message}</div>
      </Modal>
    </FeedbackContext.Provider>
  );
};

export function useToast() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useToast must be used within FeedbackProvider');
  return ctx.toast;
}

export function useConfirm() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useConfirm must be used within FeedbackProvider');
  return ctx.confirm;
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider');
  return ctx;
}
