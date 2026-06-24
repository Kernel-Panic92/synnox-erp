import axios from 'axios';

/**
 * OSRM Client - Calcula matrices de distancia/tiempo entre puntos
 * Usa Open Source Routing Machine (OSRM)
 */
export class OSRMClient {
  constructor(baseUrl = 'http://router.project-osrm.org') {
    this.baseUrl = baseUrl;
  }

  /**
   * Calcula matriz de distancias y tiempos entre múltiples puntos
   * @param {Array} puntos [{lat, lng}, {lat, lng}, ...]
   * @returns {Object} {distances: [[...], [...]], durations: [[...], [...]]}
   */
  async calcularMatriz(puntos) {
    try {
      if (puntos.length < 2) {
        throw new Error('Se necesitan al menos 2 puntos');
      }

      // Formato OSRM: lng,lat;lng,lat;...
      const coordenadas = puntos
        .map(p => `${p.lng},${p.lat}`)
        .join(';');

      const url = `${this.baseUrl}/table/v1/driving/${coordenadas}`;
      console.log('[OSRM] Solicitud:', url);

      const response = await axios.get(url, {
        params: {
          annotations: 'distance,duration'
        },
        timeout: 30000
      });

      console.log('[OSRM] Respuesta:', response.data.code, response.data.message || '');

      if (response.data.code === 'Ok') {
        return {
          distances: response.data.distances, // en metros
          durations: response.data.durations, // en segundos
          exitosa: true
        };
      } else {
        return {
          exitosa: false,
          error: response.data.message || 'Error en OSRM'
        };
      }
    } catch (err) {
      console.error('Error en OSRM:', err.message);
      return {
        exitosa: false,
        error: err.message
      };
    }
  }

  /**
   * Calcula la ruta optimizada entre múltiples puntos
   * @param {Array} puntos
   * @returns {Object} {ruta: [índices en orden], distancia, duración}
   */
  async calcularRutaOptimizada(puntos) {
    try {
      const matriz = await this.calcularMatriz(puntos);
      
      if (!matriz.exitosa) {
        throw new Error(matriz.error);
      }

      // Usar algoritmo simple: nearest neighbor + 2-opt
      // Para un MVP, esto es suficiente
      const ruta = this.nearestNeighbor(matriz.distances, 0);
      
      const distanciaTotal = this.calcularDistanciaRuta(ruta, matriz.distances);
      const duracionTotal = this.calcularDuracionRuta(ruta, matriz.durations);

      return {
        exitosa: true,
        ruta, // índices de puntos en orden
        distancia: distanciaTotal / 1000, // convertir a km
        duracion: Math.round(duracionTotal / 60) // convertir a minutos
      };
    } catch (err) {
      console.error('Error calculando ruta optimizada:', err);
      return {
        exitosa: false,
        error: err.message
      };
    }
  }

  /**
   * Obtiene la geometría (camino por carretera) entre puntos ordenados
   * @param {Array} puntos [{lat, lng}, ...] en el orden de visita
   * @returns {Object|null} GeoJSON LineString o null si falla
   */
  async obtenerGeometriaRuta(puntos) {
    try {
      if (puntos.length < 2) return null;
      const coordenadas = puntos.map(p => `${p.lng},${p.lat}`).join(';');
      const url = `${this.baseUrl}/route/v1/driving/${coordenadas}`;
      console.log('[OSRM] Geometría:', url);
      const response = await axios.get(url, {
        params: { geometries: 'geojson', overview: 'full' },
        timeout: 30000
      });
      if (response.data.code === 'Ok') {
        return response.data.routes[0].geometry;
      }
    } catch (err) {
      console.error('[OSRM] Error obteniendo geometría:', err.message);
    }
    return null;
  }

  /**
   * Algoritmo Nearest Neighbor (greedy)
   * Comienza en un punto y siempre va al más cercano no visitado
   */
  nearestNeighbor(matriz, inicio = 0) {
    const n = matriz.length;
    const visitados = new Array(n).fill(false);
    const ruta = [inicio];
    visitados[inicio] = true;

    let actual = inicio;

    for (let i = 1; i < n; i++) {
      let masProximo = -1;
      let distanciaMinima = Infinity;

      for (let j = 0; j < n; j++) {
        if (!visitados[j] && matriz[actual][j] < distanciaMinima) {
          distanciaMinima = matriz[actual][j];
          masProximo = j;
        }
      }

      if (masProximo === -1) break;

      ruta.push(masProximo);
      visitados[masProximo] = true;
      actual = masProximo;
    }

    return ruta;
  }

  /**
   * 2-opt improvement: intercambiar pares de aristas para mejorar la ruta
   */
  optimizarCon2Opt(ruta, matriz) {
    let mejora = true;
    let distanciaActual = this.calcularDistanciaRuta(ruta, matriz);

    while (mejora) {
      mejora = false;

      for (let i = 0; i < ruta.length - 1; i++) {
        for (let j = i + 2; j < ruta.length; j++) {
          const rutaNueva = [...ruta];

          // Invertir segmento [i+1...j]
          let left = i + 1;
          let right = j;
          while (left < right) {
            [rutaNueva[left], rutaNueva[right]] = [rutaNueva[right], rutaNueva[left]];
            left++;
            right--;
          }

          const nuevaDistancia = this.calcularDistanciaRuta(rutaNueva, matriz);

          if (nuevaDistancia < distanciaActual) {
            ruta = rutaNueva;
            distanciaActual = nuevaDistancia;
            mejora = true;
            break;
          }
        }
        if (mejora) break;
      }
    }

    return ruta;
  }

  calcularDistanciaRuta(ruta, matriz) {
    let distancia = 0;
    for (let i = 0; i < ruta.length - 1; i++) {
      distancia += matriz[ruta[i]][ruta[i + 1]];
    }
    return distancia;
  }

  calcularDuracionRuta(ruta, matriz) {
    let duracion = 0;
    for (let i = 0; i < ruta.length - 1; i++) {
      duracion += matriz[ruta[i]][ruta[i + 1]];
    }
    return duracion;
  }
}

/**
 * VRP Solver - Resuelve el problema de enrutamiento de vehículos
 */
export class VRPSolver {
  constructor(osrmClient) {
    this.osrm = osrmClient || new OSRMClient();
  }

  /**
   * Optimiza rutas para múltiples vehículos
   * @param {Array} pedidos [{lat, lng, id, ...}, ...]
   * @param {Array} vehiculos [{id, lat, lng, capacidad}, ...]
   * @returns {Object} {rutas: [{vehiculo, paradas: [{...}]}]}
   */
  async optimizarRutasMultiVehiculos(pedidos, vehiculos, depot) {
    try {
      console.log('[VRP] depot:', depot);
      console.log('[VRP] vehiculos recibidos:', vehiculos.length);

      // Filtrar solo pedidos con coordenadas válidas
      const pedidosValidos = pedidos.filter(p => p.lat != null && p.lng != null && !isNaN(p.lat) && !isNaN(p.lng));
      console.log('[VRP] pedidos válidos:', pedidosValidos.length);
      if (pedidosValidos.length === 0) {
        return { exitosa: false, error: 'No hay pedidos con coordenadas válidas para generar rutas' };
      }

      // Filtrar vehículos con coordenadas o usar depot
      const vehiculosConPos = vehiculos.filter(v => v.lat != null && v.lng != null && !isNaN(v.lat) && !isNaN(v.lng));
      console.log('[VRP] vehículos con posición:', vehiculosConPos.length);
      if (vehiculosConPos.length === 0 && (!depot || depot.lat == null || depot.lng == null)) {
        return { exitosa: false, error: 'No hay vehículos con posición ni depot con coordenadas' };
      }

      // Paso 1: Construir todos los puntos (depósito + pedidos)
      const vehiculosUsar = vehiculosConPos.length ? vehiculosConPos : vehiculos;
      const todosLosPuntos = vehiculosUsar.map(v => ({
        tipo: 'deposito',
        vehiculoId: v.id,
        lat: depot ? depot.lat : v.lat,
        lng: depot ? depot.lng : v.lng,
        index: -1
      }));

      pedidosValidos.forEach((p, idx) => {
        todosLosPuntos.push({
          tipo: 'pedido',
          id: p.id,
          lat: p.lat,
          lng: p.lng,
          index: idx
        });
      });

      console.log('[VRP] Total puntos para OSRM:', todosLosPuntos.length);

      // Validar que todos los puntos sean válidos antes de enviar a OSRM
      const puntos = todosLosPuntos.map(p => ({ lat: p.lat, lng: p.lng }));
      if (puntos.some(p => isNaN(p.lat) || isNaN(p.lng))) {
        return { exitosa: false, error: 'Hay coordenadas inválidas en los puntos' };
      }

      // Paso 2: Calcular matriz de distancias para todos los puntos
      const matriz = await this.osrm.calcularMatriz(puntos);

      if (!matriz.exitosa) {
        throw new Error(matriz.error);
      }

      // Paso 3: Asignar pedidos a vehículos según vehiculo_id del pedido
      const rutasPorVehiculo = {};
      vehiculosUsar.forEach(v => { rutasPorVehiculo[v.id] = []; });

      const ignorados = [];
      for (const pedido of pedidosValidos) {
        if (pedido.vehiculo_id && rutasPorVehiculo[pedido.vehiculo_id] !== undefined) {
          rutasPorVehiculo[pedido.vehiculo_id].push(pedido);
        } else {
          ignorados.push(pedido.id);
        }
      }
      if (ignorados.length > 0) {
        console.log('[VRP] pedidos sin vehiculo_id válido (ignorados):', ignorados);
      }

      // Paso 4: Optimizar cada ruta individual
      const rutas = [];

      for (const vehiculo of vehiculosUsar) {
        const pedidosVehiculo = rutasPorVehiculo[vehiculo.id];

        if (pedidosVehiculo.length === 0) continue;

        const puntosRuta = [
          { lat: depot ? depot.lat : vehiculo.lat, lng: depot ? depot.lng : vehiculo.lng }, // Depósito
          ...pedidosVehiculo.map(p => ({ lat: p.lat, lng: p.lng }))
        ];

        // Calcular ruta optimizada
        const rutaOptimizada = await this.osrm.calcularRutaOptimizada(puntosRuta);

        if (rutaOptimizada.exitosa) {
          // Convertir índices a pedidos
          const paradas = rutaOptimizada.ruta
            .slice(1) // Omitir depósito
            .map(idx => {
              if (idx === 0) return null; // Depósito
              return pedidosVehiculo[idx - 1];
            })
            .filter(p => p !== null);

          // Obtener geometría por carretera
          const puntosOrdenados = rutaOptimizada.ruta.map(idx => puntosRuta[idx]);
          const geometria = await this.osrm.obtenerGeometriaRuta(puntosOrdenados);

          rutas.push({
            vehiculoId: vehiculo.id,
            distancia: rutaOptimizada.distancia,
            duracion: rutaOptimizada.duracion,
            paradas,
            secuencia: rutaOptimizada.ruta,
            geometria
          });
        }
      }

      return {
        exitosa: true,
        rutas
      };
    } catch (err) {
      console.error('Error optimizando rutas:', err);
      return {
        exitosa: false,
        error: err.message
      };
    }
  }
}

/**
 * Export para uso simple
 */
export async function generarRutasOptimizadas(pedidos, vehiculos, osrmUrl, depot) {
  const osrm = new OSRMClient(osrmUrl);
  const solver = new VRPSolver(osrm);

  return await solver.optimizarRutasMultiVehiculos(pedidos, vehiculos, depot);
}
