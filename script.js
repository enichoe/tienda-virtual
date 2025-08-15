document.addEventListener('DOMContentLoaded', () => {
    const productList = document.getElementById('product-list');
    const cartCountSpan = document.getElementById('cart-count');
    const filterContainer = document.getElementById('filter-container');
    const notificationToastEl = document.getElementById('notification-modal');
    const notificationToast = new bootstrap.Toast(notificationToastEl);

    let allProducts = []; // Almacenar todos los productos

    function showNotification(message, type = 'success') {
        const toastBody = notificationToastEl.querySelector('.toast-body');
        toastBody.textContent = message;
        
        // Cambiar color del toast según el tipo
        notificationToastEl.classList.remove('bg-success', 'bg-info');
        if (type === 'success') {
            notificationToastEl.classList.add('bg-success');
        } else {
            notificationToastEl.classList.add('bg-info');
        }

        notificationToast.show();
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
            productList.innerHTML = '<p class="text-center text-danger">No se pudieron cargar los productos. Intenta de nuevo más tarde.</p>';
        }
    }

    function displayProducts(products) {
        productList.innerHTML = '';
        products.forEach(product => {
            const productCol = document.createElement('div');
            productCol.className = 'col';
            const isOutOfStock = product.stock <= 0;
            productCol.innerHTML = `
                <div class="card h-100 ${isOutOfStock ? 'out-of-stock' : ''}">
                    <img src="${product.imagen_url || 'https://via.placeholder.com/300'}" class="card-img-top" alt="${product.nombre}">
                    <div class="card-body d-flex flex-column">
                        <h5 class="card-title">${product.nombre}</h5>
                        <p class="card-text text-muted">${product.tipo}</p>
                        <p class="card-text">${product.descripcion || ''}</p>
                        <p class="card-text fs-5 fw-bold mt-auto">S/.${parseFloat(product.precio).toFixed(2)}</p>
                        ${isOutOfStock
                            ? '<p class="text-danger fw-bold">Producto sin Stock</p>'
                            : `<button class="btn btn-primary add-to-cart-btn" data-id="${product.id}">Comprar</button>`
                        }
                    </div>
                </div>
            `;
            productList.appendChild(productCol);
        });
    }

    function displayFilterButtons() {
        const tipos = ['Todos', ...new Set(allProducts.map(p => p.tipo))];
        filterContainer.innerHTML = '';
        tipos.forEach(tipo => {
            const button = document.createElement('button');
            button.textContent = tipo;
            button.className = 'btn btn-primary btn-sm me-2 mb-2';
            button.dataset.tipo = tipo;
            filterContainer.appendChild(button);
        });
    }

    // --- Event Listeners ---
    productList.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-to-cart-btn')) {
            const productId = parseInt(e.target.dataset.id);
            addToCart(productId);
        }
    });

    filterContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn')) {
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

    // Lógica del Chatbot
    const chatbotToggler = document.querySelector(".chatbot-toggler");
    const chatbotContainer = document.querySelector(".chatbot-container");

    if (chatbotToggler) {
        chatbotToggler.addEventListener("click", () => {
            const isDisplayed = chatbotContainer.style.display === "flex";
            chatbotContainer.style.display = isDisplayed ? "none" : "flex";
        });
    }

    window.handleChatOption = function(option) {
        const messagesContainer = document.querySelector(".chatbot-messages");
        let response = "";

        switch (option) {
            case 'compra':
                response = "Para comprar, puedes navegar por nuestros productos y añadirlos al carrito. ¿Necesitas ayuda con algo más?" ;
                // Opcional: redirigir a la sección de productos
                // window.location.href = '#product-list';
                break;
            case 'reclamo':
                response = "Lamentamos cualquier inconveniente. Por favor, envíanos un correo a reclamos@mitienda.com y te atenderemos a la brevedad.";
                break;
            case 'hablar':
                response = "Claro, puedes contactarnos al +51 900 000 000. Estaremos encantados de ayudarte.";
                break;
            case 'sugerencias':
                response = "¡Nos encantaría escuchar tus ideas! Escríbenos a sugerencias@mitienda.com.";
                break;
        }
        
        if(messagesContainer){
            messagesContainer.innerHTML += `<p style="text-align: right; color: #007bff;">Respondiendo...</p>`;
            setTimeout(() => {
                messagesContainer.innerHTML += `<p>${response}</p>`;
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 500);
        }
    }
});
