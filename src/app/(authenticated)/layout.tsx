"use client"; // Mark as a Client Component

import AppLayoutClient from '@/components/layout/AppLayoutClient';
import type { ReactNode } from 'react';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AppLayoutClient>{children}</AppLayoutClient>;
}
