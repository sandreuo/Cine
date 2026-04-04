'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export default function Header() {
  const router = useRouter();
  const [q, setQ] = useState('');

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) {
      router.push(`/?q=${encodeURIComponent(q.trim())}`);
    }
  }

  return (
    <header className="header">
      <div className="container">
        <div className="header-inner">
          <Link href="/" className="logo">
            <span className="logo-icon">🎬</span>
            <span className="logo-text">CineHoy</span>
            <span className="logo-sub">.co</span>
          </Link>

          <form onSubmit={handleSearch} className="header-search">
            <input
              className="header-search-input"
              type="search"
              placeholder="Buscar película, cine, ciudad…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Buscar"
            />
          </form>
        </div>
      </div>
    </header>
  );
}
