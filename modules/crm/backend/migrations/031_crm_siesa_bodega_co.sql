INSERT INTO crm.siesa_mapeos (tipo, crm_codigo, siesa_codigo, descripcion) VALUES
 ('bodega_co','100','10001','ITAGUI MP PESCADOS'),
 ('bodega_co','200','20002','BOG MP PESCADOS'),
 ('bodega_co','101','101','ITAGUI PT'),
 ('bodega_co','300','30001','CALI MP')
ON CONFLICT (tipo, crm_codigo) DO UPDATE SET siesa_codigo=EXCLUDED.siesa_codigo;
