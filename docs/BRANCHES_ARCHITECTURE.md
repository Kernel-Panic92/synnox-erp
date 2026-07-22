# Arquitectura: Sistema Centralizado de Sedes/Centros de Operación

## Descripción
Implementar un sistema centralizado en el launcher que sirva la configuración de sedes o centros de operación a todos los demás módulos del ERP, evitando duplicación de datos y asegurando consistencia en toda la plataforma.

## Objetivo
Establecer el launcher como fuente única de verdad para las sedes/centros de operación, permitiendo que módulos como logística, ventas, producción, etc., consuman esta configuración de forma automatizada.

## Funcionalidades requeridas

### Gestión centralizada de sedes
- **Configuración en launcher**: Crear, editar y eliminar sedes/centros de operación desde el módulo launcher.
- **Atributos de sede**: Nombre, código, ubicación, dirección, contacto, estado (activo/inactivo).
- **Asignación de responsables**: Asignar gerentes o coordinadores a cada sede.

### API o servicio de sedes
- **Endpoint de consulta**: Exponer un servicio/API que permita a otros módulos consultar las sedes disponibles.
- **Caché de configuración**: Implementar caché para mejorar el rendimiento en consultas frecuentes.
- **Eventos de sincronización**: Notificar a los módulos cuando hay cambios en las sedes.

### Integración con módulos
- **Logística**: Las sedes de logística se sincronizan automáticamente desde el launcher.
- **Ventas**: Los puntos de venta utilizan las sedes configuradas en launcher.
- **Producción**: Los centros de producción se definen desde launcher.
- **Otros módulos**: Cualquier módulo que requiera sedes accede a la configuración centralizada.

### Control de permisos
- Solo usuarios con rol administrativo pueden crear/editar sedes en launcher.
- Los módulos solo pueden leer la configuración de sedes.
- Auditoría de cambios en las sedes.

## Propuesta de Arquitectura

### 1. Modelo de Datos (Backend)

```typescript
// models/Branch.ts
interface Branch {
  id: string;
  code: string;
  name: string;
  location: string;
  address: string;
  contact: {
    email: string;
    phone: string;
  };
  managerId: string;
  coordinatorIds: string[];
  status: 'active' | 'inactive';
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    lastModifiedBy: string;
  };
}

// models/BranchAudit.ts
interface BranchAudit {
  id: string;
  branchId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  changedBy: string;
  changes: Record<string, any>;
  timestamp: Date;
}
```

### 2. Servicio Central de Sedes

```typescript
// services/BranchService.ts
import { CacheService } from './CacheService';
import { AuditService } from './AuditService';
import { EventEmitter } from 'events';

export class BranchService extends EventEmitter {
  private cacheService: CacheService;
  private auditService: AuditService;
  private readonly CACHE_KEY = 'branches:all';
  private readonly CACHE_TTL = 3600; // 1 hora

  constructor(cacheService: CacheService, auditService: AuditService) {
    super();
    this.cacheService = cacheService;
    this.auditService = auditService;
  }

  /**
   * Obtener todas las sedes activas con caché
   */
  async getAllBranches(): Promise<Branch[]> {
    const cached = await this.cacheService.get(this.CACHE_KEY);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const branches = await this.fetchBranchesFromDB();
    await this.cacheService.set(
      this.CACHE_KEY,
      JSON.stringify(branches),
      this.CACHE_TTL
    );

    return branches;
  }

  /**
   * Obtener una sede por ID
   */
  async getBranchById(id: string): Promise<Branch | null> {
    const branches = await this.getAllBranches();
    return branches.find(b => b.id === id) || null;
  }

  /**
   * Crear nueva sede
   */
  async createBranch(data: Partial<Branch>, userId: string): Promise<Branch> {
    const newBranch: Branch = {
      id: this.generateId(),
      code: data.code!,
      name: data.name!,
      location: data.location!,
      address: data.address!,
      contact: data.contact!,
      managerId: data.managerId!,
      coordinatorIds: data.coordinatorIds || [],
      status: 'active',
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: userId,
        lastModifiedBy: userId,
      },
    };

    await this.saveBranchToDB(newBranch);
    await this.auditService.logAction('CREATE', newBranch.id, userId, newBranch);
    
    // Invalidar caché y emitir evento
    await this.invalidateCache();
    this.emit('branch:created', newBranch);

    return newBranch;
  }

  /**
   * Actualizar sede existente
   */
  async updateBranch(
    id: string,
    updates: Partial<Branch>,
    userId: string
  ): Promise<Branch> {
    const branch = await this.getBranchById(id);
    if (!branch) throw new Error('Branch not found');

    const updatedBranch = {
      ...branch,
      ...updates,
      metadata: {
        ...branch.metadata,
        updatedAt: new Date(),
        lastModifiedBy: userId,
      },
    };

    await this.saveBranchToDB(updatedBranch);
    await this.auditService.logAction('UPDATE', id, userId, updates);
    
    await this.invalidateCache();
    this.emit('branch:updated', updatedBranch);

    return updatedBranch;
  }

  /**
   * Eliminar sede
   */
  async deleteBranch(id: string, userId: string): Promise<void> {
    const branch = await this.getBranchById(id);
    if (!branch) throw new Error('Branch not found');

    await this.deleteBranchFromDB(id);
    await this.auditService.logAction('DELETE', id, userId, branch);
    
    await this.invalidateCache();
    this.emit('branch:deleted', { id });
  }

  /**
   * Invalidar caché
   */
  private async invalidateCache(): Promise<void> {
    await this.cacheService.delete(this.CACHE_KEY);
  }

  private generateId(): string {
    return `branch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async fetchBranchesFromDB(): Promise<Branch[]> {
    // Implementar consulta a DB
    return [];
  }

  private async saveBranchToDB(branch: Branch): Promise<void> {
    // Implementar guardado a DB
  }

  private async deleteBranchFromDB(id: string): Promise<void> {
    // Implementar eliminación de DB
  }
}
```

### 3. API REST

```typescript
// controllers/BranchController.ts
import { Router, Request, Response } from 'express';
import { BranchService } from '../services/BranchService';
import { authorize, requireRole } from '../middleware/auth';

export class BranchController {
  private router: Router;
  private branchService: BranchService;

  constructor(branchService: BranchService) {
    this.branchService = branchService;
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // GET /api/branches - Obtener todas las sedes
    this.router.get(
      '/',
      authorize,
      this.getAllBranches.bind(this)
    );

    // GET /api/branches/:id - Obtener sede por ID
    this.router.get(
      '/:id',
      authorize,
      this.getBranchById.bind(this)
    );

    // POST /api/branches - Crear nueva sede
    this.router.post(
      '/',
      authorize,
      requireRole('admin'),
      this.createBranch.bind(this)
    );

    // PUT /api/branches/:id - Actualizar sede
    this.router.put(
      '/:id',
      authorize,
      requireRole('admin'),
      this.updateBranch.bind(this)
    );

    // DELETE /api/branches/:id - Eliminar sede
    this.router.delete(
      '/:id',
      authorize,
      requireRole('admin'),
      this.deleteBranch.bind(this)
    );
  }

  private async getAllBranches(req: Request, res: Response): Promise<void> {
    try {
      const branches = await this.branchService.getAllBranches();
      res.json({ success: true, data: branches });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  private async getBranchById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const branch = await this.branchService.getBranchById(id);
      
      if (!branch) {
        res.status(404).json({ success: false, error: 'Branch not found' });
        return;
      }

      res.json({ success: true, data: branch });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  private async createBranch(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user.id;
      const branch = await this.branchService.createBranch(req.body, userId);
      res.status(201).json({ success: true, data: branch });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  private async updateBranch(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const branch = await this.branchService.updateBranch(id, req.body, userId);
      res.json({ success: true, data: branch });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  private async deleteBranch(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      await this.branchService.deleteBranch(id, userId);
      res.json({ success: true, message: 'Branch deleted' });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  getRouter(): Router {
    return this.router;
  }
}
```

### 4. Cliente SDK para otros módulos

```typescript
// sdk/BranchClient.ts
import axios, { AxiosInstance } from 'axios';

export class BranchClient {
  private client: AxiosInstance;
  private branches: Branch[] = [];
  private updateInterval: NodeJS.Timer | null = null;

  constructor(baseURL: string, apiKey: string) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
  }

  /**
   * Inicializar cliente y comenzar sincronización
   */
  async initialize(): Promise<void> {
    await this.fetchBranches();
    this.startSync();
  }

  /**
   * Obtener todas las sedes
   */
  getBranches(): Branch[] {
    return this.branches;
  }

  /**
   * Obtener sede por ID
   */
  getBranch(id: string): Branch | undefined {
    return this.branches.find(b => b.id === id);
  }

  /**
   * Obtener sedes activas
   */
  getActiveBranches(): Branch[] {
    return this.branches.filter(b => b.status === 'active');
  }

  /**
   * Sincronizar sedes desde servidor
   */
  private async fetchBranches(): Promise<void> {
    try {
      const response = await this.client.get('/branches');
      this.branches = response.data.data;
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  }

  /**
   * Iniciar sincronización periódica (cada 5 minutos)
   */
  private startSync(): void {
    this.updateInterval = setInterval(() => {
      this.fetchBranches();
    }, 5 * 60 * 1000);
  }

  /**
   * Detener sincronización
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}
```

### 5. Ejemplo de uso en módulo de Logística

```typescript
// modules/logistics/LogisticsModule.ts
import { BranchClient } from '../../sdk/BranchClient';

export class LogisticsModule {
  private branchClient: BranchClient;

  constructor(branchClient: BranchClient) {
    this.branchClient = branchClient;
  }

  async initializeWarehouses(): Promise<void> {
    const branches = this.branchClient.getActiveBranches();
    
    for (const branch of branches) {
      await this.createWarehouse({
        name: branch.name,
        location: branch.location,
        managerId: branch.managerId,
        branchId: branch.id,
      });
    }
  }

  async createShipment(shipmentData: any): Promise<void> {
    const warehouse = this.branchClient.getBranch(shipmentData.branchId);
    
    if (!warehouse) {
      throw new Error('Warehouse not found');
    }

    // Crear envío utilizando la información de la sede
    console.log(`Creating shipment in warehouse: ${warehouse.name}`);
  }

  private async createWarehouse(data: any): Promise<void> {
    // Implementar lógica de creación
  }
}
```

## Diagrama de Flujo

```
┌─────────────────────────────────────────────────────────────┐
│                     LAUNCHER MODULE                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Branch Management UI                        │   │
│  │  (Create/Edit/Delete Branches)                      │   │
│  └────────────────────┬─────────────────────────────────┘   │
└────────────────────────┼──────────────────────────────────────┘
                         │
                         ▼
            ┌────────────────────────────────┐
            │    BranchService               │
            │  - CRUD Operations             │
            │  - Cache Management            │
            │  - Event Emission              │
            └────────┬───────────────────┬───┘
                     │                   │
            ┌────────▼──────┐   ┌────────▼──────┐
            │  Database     │   │  Redis Cache  │
            │  (Branches)   │   │  (TTL: 1hr)   │
            └───────────────┘   └───────────────┘
                     │
                     ▼
            ┌────────────────────┐
            │   REST API         │
            │  /api/branches     │
            │  /api/branches/:id │
            └────────┬───────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
    LOGISTICS    SALES       PRODUCTION
    MODULE       MODULE      MODULE
        │            │            │
        └────────────┼────────────┘
                     │
            ┌────────▼──────────────┐
            │   BranchClient SDK    │
            │  - Auto Sync (5 min)  │
            │  - Local Cache        │
            └───────────────────────┘
```

## Criterios de Aceptación
- [ ] Módulo de gestión de sedes en launcher implementado
- [ ] API/servicio expuesto para consultar sedes
- [ ] Integración con módulo de logística funcionando
- [ ] Sincronización automática en tiempo real
- [ ] Caché implementado y optimizado
- [ ] Sistema de auditoría de cambios en sedes
- [ ] Documentación de API para módulos
- [ ] SDK para consumo en otros módulos
- [ ] Pruebas unitarias e integración
