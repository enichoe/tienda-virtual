-- Crear la tabla de productos si no existe
CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    precio DECIMAL(10, 2) NOT NULL,
    imagen_url VARCHAR(255),
    tipo VARCHAR(100) NOT NULL,
    marca VARCHAR(100), -- Columna para la marca
    stock INT NOT NULL DEFAULT 0
);

-- Crear la tabla de usuarios para el login si no existe
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255),
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255),
    rol VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Comandos para actualizar una tabla existente si es necesario.
-- Descomenta y ejecuta las líneas que necesites si tu tabla 'productos' ya existe pero le faltan columnas.

-- ALTER TABLE productos ADD COLUMN IF NOT EXISTS marca VARCHAR(100);
-- ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock INT NOT NULL DEFAULT 0;
