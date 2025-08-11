// 1. Importar los módulos necesarios
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// 2. Configuración inicial
const app = express();
const port = process.env.PORT || 3000; // Usar el puerto de Render o 3000 localmente
const JWT_SECRET = process.env.JWT_SECRET || 'mi_secreto_super_secreto_para_jwt_2025';

// Configuración de Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Middleware para servir archivos estáticos (HTML, CSS, JS del frontend)
app.use(express.static(path.join(__dirname)));


// Middleware para poder leer JSON del body de las peticiones
app.use(express.json());

// 3. Configuración de la conexión a la base de datos PostgreSQL
// Render proporciona la URL de conexión en una variable de entorno.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/tienda_virtual', // Fallback para desarrollo local
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Verificar la conexión a la base de datos
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error adquiriendo cliente', err.stack);
    }
    console.log('Conectado exitosamente a la base de datos PostgreSQL.');
    client.release();
});

// 5. Rutas de la API

// --- Rutas Públicas ---
app.get('/api/productos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM productos ORDER BY id ASC;');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al obtener los productos');
    }
});

// --- Ruta para subir comprobante de pago ---
const proofStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'tienda_comprobantes',
        format: async (req, file) => 'png', // supports promises as well
        public_id: (req, file) => 'comprobante-' + Date.now(),
    },
});
const uploadProof = multer({ storage: proofStorage });

app.post('/api/submit-proof', uploadProof.single('comprobante'), (req, res) => {
    const { pedido, total } = req.body;
    if (!req.file) {
        return res.status(400).json({ message: 'No se ha subido ningún archivo.' });
    }

    // En un caso real, esta información se guardaría en una tabla de "pedidos" en la base de datos.
    // Por simplicidad, solo respondemos con éxito.
    console.log('Nuevo Pedido Recibido:');
    console.log('Total:', total);
    console.log('Productos:', pedido);
    console.log('URL del Comprobante:', req.file.path);

    res.status(200).json({ message: '¡Gracias! Hemos recibido tu comprobante y procesaremos tu pedido.' });
});


// --- Rutas de Autenticación ---

// Middleware para verificar el Token JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato: Bearer TOKEN

    if (token == null) {
        return res.sendStatus(401); // No hay token
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.sendStatus(403); // Token no es válido
        }
        req.user = user;
        next();
    });
}

// Ruta para registrar un nuevo usuario (para crear el primer admin)
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'El usuario y la contraseña son requeridos.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        // PostgreSQL usa $1, $2, etc. para los parámetros en lugar de ?
        const query = 'INSERT INTO usuarios (username, password) VALUES ($1, $2)';
        await pool.query(query, [username, hashedPassword]);
        res.status(201).json({ message: 'Usuario registrado exitosamente.' });
    } catch (err) {
        if (err.code === '23505') { // Código de error para violación de unicidad en PostgreSQL
            return res.status(409).json({ message: 'El nombre de usuario ya existe.' });
        }
        console.error(err);
        res.status(500).json({ message: 'Error al registrar el usuario.' });
    }
});

// Ruta para iniciar sesión
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'El usuario y la contraseña son requeridos.' });
    }

    try {
        const query = 'SELECT * FROM usuarios WHERE username = $1';
        const result = await pool.query(query, [username]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const user = result.rows[0];
        const isPasswordMatch = await bcrypt.compare(password, user.password);

        if (!isPasswordMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: 'Login exitoso.', token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// --- Rutas Protegidas para el Dashboard ---

// Usamos el middleware 'authenticateToken' para todas las rutas que siguen
app.use('/api/admin', authenticateToken);

// Obtener todos los productos para el dashboard
app.get('/api/admin/productos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM productos ORDER BY id ASC;');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al obtener los productos');
    }
});

// Configuración de Multer para la subida de imágenes de productos a Cloudinary
const productStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'tienda_productos',
        format: async (req, file) => 'jpg',
        public_id: (req, file) => 'producto-' + Date.now(),
    },
});
const uploadProduct = multer({ storage: productStorage });

// Agregar un nuevo producto (ahora con subida a Cloudinary)
app.post('/api/admin/productos', uploadProduct.single('imagen'), async (req, res) => {
    const { nombre, descripcion, precio } = req.body;
    const imagen_url = req.file ? req.file.path : null; // URL segura de Cloudinary

    try {
        const query = 'INSERT INTO productos (nombre, descripcion, precio, imagen_url) VALUES ($1, $2, $3, $4) RETURNING id';
        const result = await pool.query(query, [nombre, descripcion, precio, imagen_url]);
        res.status(201).json({ message: 'Producto agregado exitosamente.', insertId: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al agregar el producto.' });
    }
});

// Actualizar un producto (ahora con subida a Cloudinary opcional)
app.put('/api/admin/productos/:id', uploadProduct.single('imagen'), async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, precio, imagen_url_existente } = req.body;
    
    let imagen_url = imagen_url_existente;
    if (req.file) {
        imagen_url = req.file.path; // Si se sube una nueva, usar la URL de Cloudinary
    }

    try {
        const query = 'UPDATE productos SET nombre = $1, descripcion = $2, precio = $3, imagen_url = $4 WHERE id = $5';
        const result = await pool.query(query, [nombre, descripcion, precio, imagen_url, id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Producto no encontrado.' });
        }
        res.json({ message: 'Producto actualizado exitosamente.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al actualizar el producto.' });
    }
});

// Eliminar un producto
app.delete('/api/admin/productos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const query = 'DELETE FROM productos WHERE id = $1';
        const result = await pool.query(query, [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Producto no encontrado.' });
        }
        res.json({ message: 'Producto eliminado exitosamente.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al eliminar el producto.' });
    }
});

// Middleware para manejar errores de forma centralizada
// Se asegura de que si algo falla (p. ej. en Multer), se envíe una respuesta JSON.
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    // Si el error tiene un código de estado, úsalo. Si no, es un error interno del servidor.
    const statusCode = err.statusCode || 500;
    // Envía una respuesta JSON consistente
    res.status(statusCode).json({
        message: err.message || 'Ocurrió un error inesperado en el servidor.'
    });
});


// 6. Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});
