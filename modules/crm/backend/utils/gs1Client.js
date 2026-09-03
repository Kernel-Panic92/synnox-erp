/**
 * GS1 API Client
 * Documentacion: https://www.gs1.org/services/digital-link
 * API publica: https://id.gs1.org/gtin/{gtin}
 */

const GS1_BASE = 'https://id.gs1.org';

/**
 * Buscar producto por GTIN (EAN-13, EAN-8, UPC-A, UPC-E)
 * @param {string} gtin - Codigo de barras (13, 12, 8 digitos)
 * @returns {Object|null} - Datos del producto o null si no existe
 */
export async function lookupByGTIN(gtin) {
  try {
    // Limpiar GTIN (solo digitos)
    const cleanGtin = gtin.replace(/[^0-9]/g, '');
    if (!cleanGtin || cleanGtin.length < 8) return null;

    // Buscar en GS1 Digital Link
    const url = `${GS1_BASE}/gtin/${cleanGtin}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Extraer informacion relevante
    return {
      gtin: cleanGtin,
      nombre: data.tradeItem?.informationProvider?.name ||
              data.tradeItem?.description?.substring(0, 255) || null,
      descripcion: data.tradeItem?.description || null,
      marca: data.tradeItem?.brandName || null,
      imagen: data.tradeItem?.images?.[0]?.link || null,
      categoria: data.tradeItem?.classificationCategoryCode || null,
      peso: data.tradeItem?.netContent?.[0]?.value || null,
      unidad: data.tradeItem?.netContent?.[0]?.unitCode || null,
      activo: true
    };
  } catch (err) {
    console.error(`[GS1] Error lookup ${gtin}:`, err.message);
    return null;
  }
}

/**
 * Buscar productos por lote (varios GTINs)
 * @param {string[]} gtins - Array de codigos GTIN
 * @returns {Object} - Mapa de GTIN -> datos del producto
 */
export async function lookupBatch(gtins) {
  const results = {};
  const unique = [...new Set(gtins.map(g => g.replace(/[^0-9]/g, '')).filter(g => g.length >= 8))];

  // Buscar en paralelo (max 5 a la vez para no sobrecargar)
  for (let i = 0; i < unique.length; i += 5) {
    const batch = unique.slice(i, i + 5);
    const promises = batch.map(async (gtin) => {
      const data = await lookupByGTIN(gtin);
      if (data) results[gtin] = data;
    });
    await Promise.all(promises);
  }

  return results;
}
