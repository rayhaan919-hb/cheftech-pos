import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** Shared modal shell styled with Fellow DESIGN.md tokens (16px card radius, surface-1 border, Plus Jakarta Sans heading). */
export function Modal({ title, onClose, children, footer, wide = false }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-[#000524]/60 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-white rounded-2xl border border-[#e0edff] w-full ${
          wide ? 'max-w-2xl' : 'max-w-md'
        } shadow-2xl flex flex-col max-h-[82vh]`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0edff] shrink-0">
          <h2 className="font-display font-semibold text-lg text-[#000000] tracking-normal">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[#526066] hover:bg-[#eff6ff] hover:text-[#2941e0] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-[#e0edff] shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
