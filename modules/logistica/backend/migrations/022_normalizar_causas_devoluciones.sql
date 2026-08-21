-- El módulo está en desarrollo: alineamos los registros existentes al catálogo oficial.
UPDATE logistics.devoluciones
SET causa = CASE
  WHEN translate(lower(causa), 'áéíóúüñ', 'aeiouun') LIKE '%vencim%' OR translate(lower(causa), 'áéíóúüñ', 'aeiouun') LIKE '%vencid%'
    THEN 'VENCIDO O PROXIMO A VENCER'
  WHEN translate(lower(causa), 'áéíóúüñ', 'aeiouun') LIKE '%choque%termic%'
    THEN 'CHOQUE TERMICO'
  WHEN translate(lower(causa), 'áéíóúüñ', 'aeiouun') LIKE '%perdida%vacio%'
    THEN 'PERDIDA DE VACIO'
  WHEN translate(lower(causa), 'áéíóúüñ', 'aeiouun') IN ('calidad', 'mala presentacion')
    THEN 'MALA PRESENTACION'
  WHEN translate(lower(causa), 'áéíóúüñ', 'aeiouun') IN ('rotura', 'roto')
    THEN 'PROBLEMAS EN EL EMPAQUE'
  ELSE causa
END
WHERE causa IS NOT NULL;
