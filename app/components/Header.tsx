'use client';

export default function Header() {
    return (
        <nav className="fixed top-0 w-full z-50 border-b border-modern-border/40 glass-nav transition-all duration-300">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-center h-16 sm:h-20">
                    {/* Logo - Centered */}
                    <div className="flex items-center gap-2 sm:gap-3">
                        <span className="material-symbols-outlined text-xl sm:text-2xl text-primary">edit_document</span>
                        <span className="font-display font-bold text-lg sm:text-xl text-slate-grey tracking-tight">Handscript</span>
                    </div>
                </div>
            </div>
        </nav>
    );
}
