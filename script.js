document.addEventListener('DOMContentLoaded', () => {
    const productList = document.getElementById('product-list');
    const cartCountSpan = document.getElementById('cart-count');
    const filterContainer = document.getElementById('filter-container');
    const notificationModal = document.getElementById('notification-modal');

    let allProducts = []; // Almacenar todos los productos

    function showNotification(message, type = 'success') {
        if (!notificationModal) return;
        notificationModal.textContent = message;
        notificationModal.className = type; // 'success' o 'info'
        notificationModal.classList.add('show');

        setTimeout(() => {
            notificationModal.classList.remove('show');
        }, 3000); // Ocultar después de 3 segundos
    }

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
        if (!cart.some(item => item.id === productId)) {
            cart.push(product);
            saveCart(cart);
            showNotification(`'${product.nombre}' ha sido agregado al carrito.`, 'success');
        } else {
            showNotification(`'${product.nombre}' ya está en el carrito.`, 'info');
        }
    }

    // --- Lógica de Productos y Filtros ---
    async function fetchProducts() {
        try {
            const response = await fetch('/api/productos');
            if (!response.ok) {
                throw new Error('La respuesta de la red no fue correcta');
            }
            allProducts = await response.json();
            displayProducts(allProducts);
            displayFilterButtons();
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
            productDiv.dataset.id = product.id;
            productDiv.innerHTML = `
                <img src="${product.imagen_url || 'https://via.placeholder.com/150'}" alt="${product.nombre}">
                <h2>${product.nombre}</h2>
                <p class="product-type">${product.tipo}</p>
                <p class="product-price">$${parseFloat(product.precio).toFixed(2)}</p>
                <button class="add-to-cart-btn">Add to Cart</button>
            `;
            productList.appendChild(productDiv);
        });
    }

    function displayFilterButtons() {
        const tipos = ['Todos', ...new Set(allProducts.map(p => p.tipo))];
        filterContainer.innerHTML = '';
        tipos.forEach(tipo => {
            const button = document.createElement('button');
            button.textContent = tipo;
            button.className = 'btn filter-btn';
            button.dataset.tipo = tipo;
            filterContainer.appendChild(button);
        });
    }

    // --- Event Listeners ---
    productList.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-to-cart-btn')) {
            const productId = parseInt(e.target.closest('.product').dataset.id);
            addToCart(productId);
        }
    });

    filterContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-btn')) {
            const tipo = e.target.dataset.tipo;
            if (tipo === 'Todos') {
                displayProducts(allProducts);
            } else {
                const filteredProducts = allProducts.filter(p => p.tipo === tipo);
                displayProducts(filteredProducts);
            }
        }
    });

    // --- Inicialización ---
    updateCartCount();
    fetchProducts();
});
