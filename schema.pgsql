-- Crear la tabla de productos si no existe
CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    precio DECIMAL(10, 2) NOT NULL,
    imagen_url VARCHAR(255)
);

-- Crear la tabla de usuarios para el login si no existe
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL
);

-- Insertar algunos productos de ejemplo (opcional, se puede hacer desde el dashboard)
-- Es mejor no ejecutar esto automáticamente en producción para no tener datos de prueba.
-- INSERT INTO productos (nombre, descripcion, precio, imagen_url) VALUES
-- ('Laptop Pro', 'Una laptop potente para profesionales.', 1200.00, 'https://via.placeholder.com/150'),
-- ('Smartphone X', 'El último modelo de smartphone con cámara avanzada.', 800.50, 'https://via.placeholder.com/150'),
-- ('Auriculares Inalámbricos', 'Auriculares con cancelación de ruido.', 150.75, 'https://via.placeholder.com/150');
