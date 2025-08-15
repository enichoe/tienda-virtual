// 0. Cargar variables de entorno
require('dotenv').config();

// 1. Importar los módulos necesarios
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const PDFDocument = require('pdfkit');

// 2. Configuración inicial
const app = express();
const port = process.env.PORT || 3000; // Usar el puerto de Render o 3000 localmente
const JWT_SECRET = process.env.JWT_SECRET || '150609';

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
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Verificar la conexión y aplicar migraciones si es necesario
pool.connect(async (err, client, release) => {
    if (err) {
        return console.error('Error adquiriendo cliente', err.stack);
    }
    console.log('Conectado exitosamente a la base de datos PostgreSQL.');

    try {
        // Migración: Asegurarse de que la columna 'marca' y 'stock' existan.
        // Esto hace que el esquema de la base de datos sea más robusto y se auto-corrija.
        await client.query('ALTER TABLE productos ADD COLUMN IF NOT EXISTS marca VARCHAR(100);');
        await client.query('ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock INT NOT NULL DEFAULT 0;');
        console.log("Migración: Columnas 'marca' y 'stock' aseguradas.");

        // Migración: Asegurarse de que la columna 'nombre' exista en la tabla 'usuarios'.
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nombre VARCHAR(255);');
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;');
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password VARCHAR(255);');
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol VARCHAR(50);');
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;');

        // Parche para esquemas antiguos: si 'username' existe, permitir que sea nulo,
        // ya que la aplicación ahora usa 'email' como identificador único.
        try {
            await client.query('ALTER TABLE usuarios ALTER COLUMN username DROP NOT NULL;');
        } catch (e) {
            if (e.code !== '42703') { // Ignora el error si la columna 'username' no existe
                throw e;
            }
        }
        
        console.log("Migración: Columnas 'nombre', 'email', 'password', 'rol' y 'created_at' en 'usuarios' aseguradas.");

        // Migración: Crear tablas de pedidos si no existen.
        await client.query(`
            CREATE TABLE IF NOT EXISTS pedidos (
                id SERIAL PRIMARY KEY,
                usuario_id INT REFERENCES usuarios(id),
                total DECIMAL(10, 2) NOT NULL,
                comprobante_url VARCHAR(255) NOT NULL,
                estado VARCHAR(50) DEFAULT 'pendiente',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS pedido_items (
                id SERIAL PRIMARY KEY,
                pedido_id INT REFERENCES pedidos(id) ON DELETE CASCADE,
                producto_id INT REFERENCES productos(id),
                cantidad INT NOT NULL,
                precio_unitario DECIMAL(10, 2) NOT NULL
            );
        `);
        console.log("Migración: Tablas 'pedidos' y 'pedido_items' aseguradas.");

        // Migración para permitir que comprobante_url sea nulo
        try {
            await client.query('ALTER TABLE pedidos ALTER COLUMN comprobante_url DROP NOT NULL;');
            console.log("Migración: Columna 'comprobante_url' en 'pedidos' ahora permite valores nulos.");
        } catch (e) {
            // Ignorar el error si la columna ya fue alterada, lo cual es común en reinicios del servidor.
            if (e.message.includes("is not defined as NOT NULL")) {
                console.log("Info: La columna 'comprobante_url' ya permite nulos.");
            } else {
                throw e; // Lanzar otros errores
            }
        }

        // Creación del usuario administrador si no existe
        try {
            const adminEmail = 'admin@admin.com';
            const adminResult = await client.query('SELECT id FROM usuarios WHERE email = $1', [adminEmail]);
            
            if (adminResult.rows.length === 0) {
                console.log(`El usuario administrador '${adminEmail}' no existe. Creándolo...`);
                const adminPassword = 'admin@';
                const hashedPassword = await bcrypt.hash(adminPassword, 10);
                await client.query(
                    'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4)',
                    ['Administrador', adminEmail, hashedPassword, 'admin']
                );
                console.log(`Usuario administrador '${adminEmail}' creado exitosamente.`);
            } else {
                console.log(`El usuario administrador '${adminEmail}' ya existe.`);
            }
        } catch (adminError) {
            console.error('Error al verificar o crear el usuario administrador:', adminError);
        }

    } catch (migrationError) {
        console.error('Error durante la migración de la base de datos:', migrationError.stack);
    } finally {
        // Liberar el cliente de vuelta al pool.
        release();
    }
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

// --- Ruta para crear un nuevo pedido ---
const proofStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'tienda_comprobantes',
        format: async (req, file) => 'png',
        public_id: (req, file) => 'comprobante-' + Date.now(),
    },
});
const uploadProof = multer({ storage: proofStorage });

app.post('/api/orders', authenticateToken, uploadProof.single('comprobante'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { pedido, total } = req.body;
        const usuario_id = req.user.id;
        const comprobante_url = req.file ? req.file.path : null;

        if (!comprobante_url) {
            return res.status(400).json({ message: 'El comprobante de pago es requerido.' });
        }

        const pedidoItems = JSON.parse(pedido);
        if (!Array.isArray(pedidoItems) || pedidoItems.length === 0) {
            return res.status(400).json({ message: 'El pedido no contiene items.' });
        }

        await client.query('BEGIN');

        // 1. Verificar stock
        for (const item of pedidoItems) {
            const stockResult = await client.query('SELECT stock FROM productos WHERE id = $1 FOR UPDATE', [item.id]);
            if (stockResult.rows.length === 0 || stockResult.rows[0].stock < 1) { // Asumimos cantidad 1
                throw new Error(`El producto '${item.nombre}' está fuera de stock.`);
            }
        }

        // 2. Crear el pedido
        const pedidoResult = await client.query(
            'INSERT INTO pedidos (usuario_id, total, comprobante_url) VALUES ($1, $2, $3) RETURNING id',
            [usuario_id, parseFloat(total), comprobante_url]
        );
        const pedidoId = pedidoResult.rows[0].id;

        // 3. Insertar items del pedido y actualizar stock
        for (const item of pedidoItems) {
            await client.query(
                'INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)',
                [pedidoId, item.id, 1, parseFloat(item.precio)] // Asumimos cantidad 1
            );
            await client.query(
                'UPDATE productos SET stock = stock - 1 WHERE id = $1',
                [item.id]
            );
        }

        await client.query('COMMIT');
        res.status(201).json({ message: '¡Gracias! Hemos recibido tu comprobante y procesaremos tu pedido.', pedidoId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al procesar el pedido:', error);
        res.status(500).json({ message: error.message || 'Error al procesar el pedido.' });
    } finally {
        client.release();
    }
});

app.post('/api/confirm-order', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const { pedido, total, paymentMethod } = req.body;
        const usuario_id = req.user.id;

        const pedidoItems = pedido;
        if (!Array.isArray(pedidoItems) || pedidoItems.length === 0) {
            return res.status(400).json({ message: 'El pedido no contiene items.' });
        }

        await client.query('BEGIN');

        // 1. Verificar stock
        for (const item of pedidoItems) {
            const stockResult = await client.query('SELECT stock FROM productos WHERE id = $1 FOR UPDATE', [item.id]);
            if (stockResult.rows.length === 0 || stockResult.rows[0].stock < 1) { // Asumimos cantidad 1
                throw new Error(`El producto '${item.nombre}' está fuera de stock.`);
            }
        }

        // 2. Crear el pedido (sin comprobante_url para 'card' o si se maneja diferente)
        const pedidoResult = await client.query(
            'INSERT INTO pedidos (usuario_id, total, estado) VALUES ($1, $2, $3) RETURNING id',
            [usuario_id, parseFloat(total), paymentMethod === 'card' ? 'aprobado' : 'pendiente']
        );
        const pedidoId = pedidoResult.rows[0].id;

        // 3. Insertar items del pedido y actualizar stock
        for (const item of pedidoItems) {
            await client.query(
                'INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)',
                [pedidoId, item.id, 1, parseFloat(item.precio)] // Asumimos cantidad 1
            );
            await client.query(
                'UPDATE productos SET stock = stock - 1 WHERE id = $1',
                [item.id]
            );
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Compra confirmada exitosamente. Tu pedido está siendo procesado.', pedidoId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al confirmar el pedido:', error);
        res.status(500).json({ message: error.message || 'Error al confirmar el pedido.' });
    } finally {
        client.release();
    }
});


// --- Rutas de Autenticación ---

// --- Rutas de Autenticación para Clientes ---

// Ruta para registrar un nuevo cliente
app.post('/api/users/register', async (req, res) => {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password) {
        return res.status(400).json({ message: 'Nombre, email y contraseña son requeridos.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const rol = 'cliente'; // Todos los registros desde aquí son clientes

        const query = 'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4)';
        await pool.query(query, [nombre, email, hashedPassword, rol]);
        res.status(201).json({ message: 'Usuario registrado exitosamente.' });
    } catch (err) {
        if (err.code === '23505') { // unique_violation
            return res.status(409).json({ message: 'El email ya está registrado.' });
        }
        console.error(err);
        res.status(500).json({ message: 'Error al registrar el usuario.' });
    }
});

// Ruta para iniciar sesión de clientes
app.post('/api/users/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'El email y la contraseña son requeridos.' });
    }

    try {
        const query = 'SELECT * FROM usuarios WHERE email = $1';
        const result = await pool.query(query, [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const user = result.rows[0];
        const isPasswordMatch = await bcrypt.compare(password, user.password);

        if (!isPasswordMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }
        
        // Se puede loguear cualquier usuario, no solo clientes.
        // La restricción de acceso se hará en el frontend o en rutas específicas.
        const token = jwt.sign({ id: user.id, nombre: user.nombre, rol: user.rol }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: 'Login exitoso.', token });
    } catch (err) {
        console.error('Error en /api/users/login:', err);
        res.status(500).json({ message: 'Error en el servidor.', error: err.message });
    }
});


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

// Middleware para verificar si el usuario es administrador
async function isAdmin(req, res, next) {
    try {
        const result = await pool.query('SELECT rol FROM usuarios WHERE id = $1', [req.user.id]);
        if (result.rows.length > 0 && result.rows[0].rol === 'admin') {
            next();
        } else {
            res.status(403).json({ message: 'Acceso denegado. Se requiere rol de administrador.' });
        }
    } catch (error) {
        console.error('Error en middleware isAdmin:', error);
        res.status(500).json({ message: 'Error del servidor al verificar el rol del usuario.' });
    }
}

// Ruta para registrar un nuevo usuario (para crear el primer admin)
app.post('/api/register', async (req, res) => {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password) {
        return res.status(400).json({ message: 'Nombre, email y contraseña son requeridos.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        // Por defecto, el primer usuario es admin, los demás son 'user'
        const userCountResult = await pool.query('SELECT COUNT(*) FROM usuarios');
        const rol = parseInt(userCountResult.rows[0].count) === 0 ? 'admin' : 'user';

        const query = 'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4)';
        await pool.query(query, [nombre, email, hashedPassword, rol]);
        res.status(201).json({ message: 'Usuario registrado exitosamente.' });
    } catch (err) {
        if (err.code === '23505') { // unique_violation
            return res.status(409).json({ message: 'El email ya está registrado.' });
        }
        console.error(err);
        res.status(500).json({ message: 'Error al registrar el usuario.' });
    }
});

// Ruta para iniciar sesión
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'El email y la contraseña son requeridos.' });
    }

    try {
        const query = 'SELECT * FROM usuarios WHERE email = $1';
        const result = await pool.query(query, [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const user = result.rows[0];
        const isPasswordMatch = await bcrypt.compare(password, user.password);

        if (!isPasswordMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }

        const token = jwt.sign({ id: user.id, nombre: user.nombre, rol: user.rol }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: 'Login exitoso.', token });
    } catch (err) {
        console.error('Error en /api/login:', err);
        res.status(500).json({ message: 'Error en el servidor.', error: err.message });
    }
});

// --- Rutas Protegidas para el Dashboard ---

// Obtener todos los productos para el dashboard (accesible para usuarios logueados)
app.get('/api/admin/productos', authenticateToken, async (req, res) => {
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

// Agregar un nuevo producto (cualquier usuario logueado)
app.post('/api/admin/productos', authenticateToken, uploadProduct.single('imagen'), async (req, res) => {
    const { nombre, descripcion, precio, tipo, marca, stock } = req.body;
    const imagen_url = req.file ? req.file.path : null;

    const numericPrice = parseFloat(precio);
    const integerStock = parseInt(stock, 10);

    if (isNaN(numericPrice) || isNaN(integerStock)) {
        return res.status(400).json({ message: 'Precio y stock deben ser números válidos.' });
    }

    try {
        const query = 'INSERT INTO productos (nombre, descripcion, precio, imagen_url, tipo, marca, stock) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id';
        const result = await pool.query(query, [nombre, descripcion, numericPrice, imagen_url, tipo, marca, integerStock]);
        res.status(201).json({ message: 'Producto agregado exitosamente.', insertId: result.rows[0].id });
    } catch (err) {
        console.error('Error al agregar producto:', err);
        res.status(500).json({ message: 'Error al agregar el producto.', error: err.message });
    }
});

// Actualizar un producto (cualquier usuario logueado)
app.put('/api/admin/productos/:id', authenticateToken, uploadProduct.single('imagen'), async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, precio, tipo, marca, stock, imagen_url_existente } = req.body;
    
    let imagen_url = imagen_url_existente;
    if (req.file) {
        imagen_url = req.file.path;
    }

    const numericPrice = parseFloat(precio);
    const integerStock = parseInt(stock, 10);

    if (isNaN(numericPrice) || isNaN(integerStock)) {
        return res.status(400).json({ message: 'Precio y stock deben ser números válidos.' });
    }

    try {
        const query = 'UPDATE productos SET nombre = $1, descripcion = $2, precio = $3, imagen_url = $4, tipo = $5, marca = $6, stock = $7 WHERE id = $8';
        const result = await pool.query(query, [nombre, descripcion, numericPrice, imagen_url, tipo, marca, integerStock, id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Producto no encontrado.' });
        }
        res.json({ message: 'Producto actualizado exitosamente.' });
    } catch (err) {
        console.error('Error al actualizar producto:', err);
        res.status(500).json({ message: 'Error al actualizar el producto.', error: err.message });
    }
});

// Eliminar un producto (cualquier usuario logueado)
app.delete('/api/admin/productos/:id', authenticateToken, async (req, res) => {
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

// --- Rutas de Gestión de Usuarios (solo admin) ---

// Obtener todos los usuarios
app.get('/api/admin/usuarios', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nombre, email, rol FROM usuarios ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener usuarios:', err);
        res.status(500).json({ message: 'Error al obtener los usuarios.' });
    }
});

// Crear un nuevo usuario
app.post('/api/admin/usuarios', authenticateToken, isAdmin, async (req, res) => {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) {
        return res.status(400).json({ message: 'Todos los campos son requeridos.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = 'INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4) RETURNING id';
        const result = await pool.query(query, [nombre, email, hashedPassword, rol]);
        res.status(201).json({ message: 'Usuario creado exitosamente.', id: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'El email ya está en uso.' });
        }
        console.error('Error al crear usuario:', err);
        res.status(500).json({ message: 'Error al crear el usuario.' });
    }
});

// Actualizar un usuario
app.put('/api/admin/usuarios/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { nombre, email, password, rol } = req.body;

    try {
        let query;
        const params = [];
        
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            query = 'UPDATE usuarios SET nombre = $1, email = $2, password = $3, rol = $4 WHERE id = $5';
            params.push(nombre, email, hashedPassword, rol, id);
        } else {
            query = 'UPDATE usuarios SET nombre = $1, email = $2, rol = $3 WHERE id = $4';
            params.push(nombre, email, rol, id);
        }

        const result = await pool.query(query, params);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }
        res.json({ message: 'Usuario actualizado exitosamente.' });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'El email ya está en uso por otro usuario.' });
        }
        console.error('Error al actualizar usuario:', err);
        res.status(500).json({ message: 'Error al actualizar el usuario.' });
    }
});

// Eliminar un usuario
app.delete('/api/admin/usuarios/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        // Opcional: No permitir que un admin se elimine a sí mismo
        if (parseInt(id, 10) === req.user.id) {
            return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta de administrador.' });
        }
        const result = await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }
        res.json({ message: 'Usuario eliminado exitosamente.' });
    } catch (err) {
        console.error('Error al eliminar usuario:', err);
        res.status(500).json({ message: 'Error al eliminar el usuario.' });
    }
});

// --- Rutas de Gestión de Pedidos (solo admin) ---
app.get('/api/admin/pedidos', authenticateToken, isAdmin, async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id, p.total, p.comprobante_url, p.estado, p.created_at,
                u.nombre as usuario_nombre, u.email as usuario_email
            FROM pedidos p
            JOIN usuarios u ON p.usuario_id = u.id
            ORDER BY p.created_at DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener pedidos:', err);
        res.status(500).json({ message: 'Error al obtener los pedidos.' });
    }
});

app.put('/api/admin/pedidos/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    if (!estado) {
        return res.status(400).json({ message: 'El estado es requerido.' });
    }
    try {
        const query = 'UPDATE pedidos SET estado = $1 WHERE id = $2';
        const result = await pool.query(query, [estado, id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Pedido no encontrado.' });
        }
        res.json({ message: 'Estado del pedido actualizado exitosamente.' });
    } catch (err) {
        console.error('Error al actualizar el estado del pedido:', err);
        res.status(500).json({ message: 'Error al actualizar el estado del pedido.' });
    }
});


// --- Rutas de Reportes (solo admin) ---
function generatePdfReport(res, title, headers, data) {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    const filename = `${title.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.pdf`;

    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Encabezado
    doc.fontSize(20).text(`Reporte de ${title}`, { align: 'center' });
    doc.fontSize(10).text(`Generado el: ${new Date().toLocaleString('es-ES')}`, { align: 'center' });
    doc.moveDown(2);

    // Tabla
    const tableTop = doc.y;
    const itemHeight = 20;
    const colWidths = headers.map(() => (doc.page.width - 60) / headers.length);

    // Encabezados de la tabla
    doc.fontSize(10).font('Helvetica-Bold');
    headers.forEach((header, i) => {
        doc.text(header, 30 + colWidths.slice(0, i).reduce((a, b) => a + b, 0), tableTop, { width: colWidths[i], align: 'center' });
    });
    doc.y += itemHeight;
    doc.font('Helvetica');

    // Filas de la tabla
    data.forEach(row => {
        const y = doc.y;
        if (y + itemHeight > doc.page.height - 30) {
            doc.addPage();
            doc.y = 30;
        }
        headers.forEach((header, i) => {
            const key = header.toLowerCase().replace(/\s+/g, '_');
            let value = row[key] !== null && row[key] !== undefined ? row[key].toString() : 'N/A';
            if (key === 'fecha_registro' || key === 'fecha_pedido') {
                value = new Date(value).toLocaleString('es-ES');
            }
            doc.text(value, 30 + colWidths.slice(0, i).reduce((a, b) => a + b, 0), doc.y, { width: colWidths[i], align: 'left' });
        });
        doc.y += itemHeight;
    });

    doc.end();
}

app.get('/api/admin/reportes/:type', authenticateToken, isAdmin, async (req, res) => {
    const { type } = req.params;
    
    try {
        if (type === 'sales') {
            const result = await pool.query(`
                SELECT p.id as pedido_id, u.nombre as usuario, pr.nombre as producto, pi.cantidad, pi.precio_unitario, p.created_at as fecha_pedido
                FROM pedidos p
                JOIN usuarios u ON p.usuario_id = u.id
                JOIN pedido_items pi ON p.id = pi.pedido_id
                JOIN productos pr ON pi.producto_id = pr.id
                ORDER BY p.created_at DESC
            `);
            generatePdfReport(res, 'Ventas', ['Pedido ID', 'Usuario', 'Producto', 'Cantidad', 'Precio Unitario', 'Fecha Pedido'], result.rows);
        } else if (type === 'users') {
            const result = await pool.query('SELECT id, nombre, email, rol, created_at as fecha_registro FROM usuarios');
            generatePdfReport(res, 'Usuarios', ['ID', 'Nombre', 'Email', 'Rol', 'Fecha Registro'], result.rows);
        } else if (type === 'stock') {
            const result = await pool.query('SELECT id, nombre, marca, stock, precio FROM productos');
            generatePdfReport(res, 'Stock', ['ID', 'Nombre', 'Marca', 'Stock', 'Precio'], result.rows);
        } else {
            return res.status(400).json({ message: 'Tipo de reporte no válido.' });
        }
    } catch (err) {
        console.error(`Error al generar reporte de ${type}:`, err);
        res.status(500).json({ message: `Error al generar el reporte de ${type}.` });
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
