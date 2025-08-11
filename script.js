document.addEventListener('DOMContentLoaded', () => {
    const productList = document.getElementById('product-list');
    const cartCountSpan = document.getElementById('cart-count');

    let allProducts = []; // Almacenar productos para un acceso fácil

    // --- Lógica del Carrito ---
    function getCart() {
        return JSON.parse(localStorage.getItem('cart')) || [];
    }

    function saveCart(cart) {
        localStorage.setItem('cart', JSON.stringify(cart));
        updateCartCount();
    }

    function updateCartCount() {
        const cart = getCart();
        cartCountSpan.textContent = cart.length;
    }

    function addToCart(productId) {
        const product = allProducts.find(p => p.id === productId);
        if (!product) return;

        const cart = getCart();
        // Prevenir duplicados
        if (!cart.some(item => item.id === productId)) {
            cart.push(product);
            saveCart(cart);
            alert(`'${product.nombre}' ha sido agregado al carrito.`);
        } else {
            alert(`'${product.nombre}' ya está en el carrito.`);
        }
    }

    // --- Lógica de Productos ---
    async function fetchProducts() {
        try {
            const response = await fetch('/api/productos');
            if (!response.ok) {
                throw new Error('La respuesta de la red no fue correcta');
            }
            allProducts = await response.json(); // Guardar en la variable global
            displayProducts(allProducts);
        } catch (error) {
            console.error('Hubo un problema con la operación de fetch:', error);
            productList.innerHTML = '<p>No se pudieron cargar los productos. Intenta de nuevo más tarde.</p>';
        }
    }

    function displayProducts(products) {
        productList.innerHTML = '';
        products.forEach(product => {
            const productDiv = document.createElement('div');
            productDiv.className = 'product';
            productDiv.dataset.id = product.id; // Guardar el ID en el elemento
            productDiv.innerHTML = `
                <img src="${product.imagen_url || 'https://via.placeholder.com/150'}" alt="${product.nombre}">
                <h2>${product.nombre}</h2>
                <p>$${parseFloat(product.precio).toFixed(2)}</p>
                <button class="add-to-cart-btn">Add to Cart</button>
            `;
            productList.appendChild(productDiv);
        });
    }

    // --- Event Listeners ---
    productList.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-to-cart-btn')) {
            const productId = parseInt(e.target.closest('.product').dataset.id);
            addToCart(productId);
        }
    });

    // --- Inicialización ---
    updateCartCount();
    fetchProducts();
});
