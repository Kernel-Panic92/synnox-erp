-- EAN por sucursal (viene en el maestro Clientes ERP.csv columna "Código EAN")
ALTER TABLE crm.sucursales ADD COLUMN IF NOT EXISTS codigo_ean VARCHAR(50);