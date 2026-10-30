// ============================================================
//  CONFIGURACIÓN DE LA PÁGINA (estos datos son públicos, no son secretos)
//  Los datos privados (banco, precio, lista de invitados) viven en la base.
// ============================================================
window.BODA = {
  // Se completan en el paso "Conectar la página con la base" de la guía.
  // Mientras estén vacíos la página funciona en MODO PRUEBA (códigos 2027 y 5050).
  supabaseUrl: 'https://owtrxbsuahiivyttweii.supabase.co',
  supabaseKey: 'sb_publishable_UVixAIETI2d3C0EyslrKfg_hS9SYLUO',

  weddingDate: '2027-04-10T18:00:00-03:00',
  rsvpDeadlineText: '31 de enero de 2027',

  // Foto de "Nuestra historia" (la elige Ema): copiá la foto a la carpeta img/
  // y escribí acá su ruta, por ejemplo: 'img/historia.jpg'. Vacío = recuadro "FOTO".
  storyPhoto: 'img/historia.webp'
};
