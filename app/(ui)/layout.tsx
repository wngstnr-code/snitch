import { AppShell } from '@/components/site/app-shell';

export default function UiLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
