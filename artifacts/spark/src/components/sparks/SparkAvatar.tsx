import { photoUrl } from '@/lib/supabase';

export function SparkAvatar({ path, name, size = 48, className = '' }: { path?: string | null; name: string; size?: number; className?: string }) {
  const url = path ? photoUrl(path) : '';
  return (
    <div className={`sk-avatar ${className}`} style={{ width: size, height: size }}>
      {url
        ? <img src={url} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
        : <span className="display font-extrabold text-rose-100/70" style={{ fontSize: size * 0.42 }}>{(name || '?').slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}
