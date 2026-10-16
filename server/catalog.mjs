export const CATEGORIES = [
  { id: 'baby', name: 'El mundo de Colomba', description: 'Cuna, chupete, babero y más', icon: 'carriage' },
  { id: 'arrival', name: 'Preparando su llegada', description: 'Regalos, mantas y preparativos', icon: 'gift' },
  { id: 'family', name: 'Nuestra familia', description: 'Agrega sus propias palabras', icon: 'home' },
];

export function seedCatalog() {
  const baby = ['Coche de guagua', 'Chupete', 'Cuna', 'Babero', 'Mamadera', 'Pañal', 'Sonajero', 'Peluche', 'Patucos', 'Manta', 'Mudador', 'Móvil de cuna', 'Silla de comer', 'Bañera', 'Mordedor', 'Pijama', 'Gorro', 'Calcetines', 'Toallitas húmedas', 'Monitor de guagua', 'Portabebé', 'Cuento', 'Canción de cuna', 'Leche', 'Siesta', 'Primeros pasos', 'Gatear', 'Hipo', 'Risa', 'Manitos'];
  const arrival = ['Baby shower', 'Regalo', 'Bolso de maternidad', 'Habitación', 'Álbum de fotos', 'Globos', 'Torta', 'Lazo', 'Invitación', 'Ecografía', 'Nombre', 'Familia', 'Bienvenida', 'Abrazo', 'Tarjeta', 'Cámara de fotos', 'Decoración', 'Flores', 'Caja de recuerdos', 'Mecedora'];
  return [...baby.map((word, i) => ({ id: `baby-${i}`, word, category: 'baby', enabled: true })), ...arrival.map((word, i) => ({ id: `arrival-${i}`, word, category: 'arrival', enabled: true }))];
}
