import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title:'Speedway · Inventario de entrenamiento', description:'Laboratorio de revisión de inventario físico Speedway', robots:{index:false,follow:false} };
export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="es"><body>{children}</body></html>;
}
