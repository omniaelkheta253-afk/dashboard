        // Default clean base parameters
        const defaultMaterials = ["Natural Silk", "Linen", "Egyptian Cotton", "Premium Velvet"];
        const defaultColors = ["Black", "Off-White", "Bronze", "Satin Rose", "Royal Emerald"];
        const defaultSizes = ["S", "M", "L", "XL"];

        // Start memory containers completely fresh - will be populated by Database or fallback
        let UNSEEN_MATERIALS = [...defaultMaterials];
        let UNSEEN_COLORS = [...defaultColors];
        let UNSEEN_SIZES = [...defaultSizes];
        let UNSEEN_PRODUCTS = [];
        let UNSEEN_ORDERS = [];
        let UNSEEN_CUSTOM_ATTRIBUTES = [];

        // Financial coefficients loaded dynamically
        let UNSEEN_CAPACITY = 18;
        let UNSEEN_MARGIN = 50;

        // Image compression temporary buffers
        let tempNewProductImages = [];
        let tempEditProductImages = [];
        let tempFeedbackImage = "";

        // Dynamic product model items (new product form)
        let prodItemRowSeq = 0;
        const productItemCosts = {};

        let piecesChart, fabricsChart, sizesChart;
        let activeConfirmAction = null;
        let activeEditAttrCategory = null; 
        let activeEditAttrIndex = null;
        let activeEditCustomAttrOptionIndex = null; 

        // Database variables
        let db, auth;
        let isFirebaseActive = false;
        let appId = 'unseen-brand-dashboard';

        // Initialize Firebase system
        async function initConnectedDatabase() {
            // Retrieve environment variables
            const app_id_env = typeof __app_id !== 'undefined' ? __app_id : 'unseen-brand-dashboard';
            appId = app_id_env;
            const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
            const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

            if (!firebaseConfig) {
                console.warn("No firebase config found. Running in localized standalone fallback mode.");
                isFirebaseActive = false;
                setupLocalFallbackData();
                checkAtelierAuth();
                return;
            }

            try {
                // Initialize Firebase Apps safely
                const app = window.F_API.initializeApp(firebaseConfig);
                db = window.F_API.getFirestore(app);
                auth = window.F_API.getAuth(app);
                isFirebaseActive = true;

                // RULE 3 - Authenticate BEFORE queries
                if (initialAuthToken) {
                    await window.F_API.signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await window.F_API.signInAnonymously(auth);
                }

                // Register real-time sync listeners
                setupRealtimeSyncListeners();

            } catch (err) {
                console.error("Firebase Database Connection Error. Falling back to offline mode:", err);
                isFirebaseActive = false;
                setupLocalFallbackData();
                checkAtelierAuth();
            }
        }

        // Offline local fallback loader
        function setupLocalFallbackData() {
            UNSEEN_MATERIALS = JSON.parse(localStorage.getItem('unseen_materials_v2')) || defaultMaterials;
            UNSEEN_COLORS = JSON.parse(localStorage.getItem('unseen_colors_v2')) || defaultColors;
            UNSEEN_SIZES = JSON.parse(localStorage.getItem('unseen_sizes_v2')) || defaultSizes;
            UNSEEN_PRODUCTS = JSON.parse(localStorage.getItem('unseen_products_v2')) || [];
            UNSEEN_PRODUCTS.forEach(p => syncProductAggregateStock(p));
            UNSEEN_ORDERS = JSON.parse(localStorage.getItem('unseen_orders_v2')) || [];
            UNSEEN_CUSTOM_ATTRIBUTES = JSON.parse(localStorage.getItem('unseen_custom_attrs_v2')) || [];
            UNSEEN_CAPACITY = parseFloat(localStorage.getItem('unseen_capacity_v2')) || 18;
            UNSEEN_MARGIN = parseFloat(localStorage.getItem('unseen_margin_v2')) || 50;
        }

        // Live synchronizer listener
        function setupRealtimeSyncListeners() {
            // Document path: RULE 1 - Strict paths
            const configDocPath = window.F_API.doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
            const productsColPath = window.F_API.collection(db, 'artifacts', appId, 'public', 'data', 'products');
            const ordersColPath = window.F_API.collection(db, 'artifacts', appId, 'public', 'data', 'orders');

            // 1. Listen to config changes
            window.F_API.onSnapshot(configDocPath, (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    UNSEEN_MATERIALS = data.materials || defaultMaterials;
                    UNSEEN_COLORS = data.colors || defaultColors;
                    UNSEEN_SIZES = data.sizes || defaultSizes;
                    UNSEEN_CUSTOM_ATTRIBUTES = data.custom_attributes || [];
                    UNSEEN_CAPACITY = data.capacity || 18;
                    UNSEEN_MARGIN = data.margin || 50;

                    if (data.master_user) localStorage.setItem('unseen_master_user', data.master_user);
                    if (data.master_pass) localStorage.setItem('unseen_master_pass', data.master_pass);
                } else {
                    // Initialize empty config doc if missing
                    saveConfigToFirebase();
                }
                checkAtelierAuth();
            }, (err) => {
                console.error("Realtime config sync failed:", err);
            });

            // 2. Listen to products list updates
            window.F_API.onSnapshot(productsColPath, (querySnap) => {
                const prodList = [];
                querySnap.forEach((doc) => {
                    prodList.push({ id: doc.id, ...doc.data() });
                });
                // Sort chronologically (oldest to newest in memory, reverse-rendered in UI)
                prodList.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                UNSEEN_PRODUCTS = prodList;
                UNSEEN_PRODUCTS.forEach(p => syncProductAggregateStock(p));

                // Sync UI elements
                renderActiveCatalog();
                syncButtonStates();
            }, (err) => {
                console.error("Realtime products sync failed:", err);
            });

            // 3. Listen to orders list updates
            window.F_API.onSnapshot(ordersColPath, (querySnap) => {
                const orderList = [];
                querySnap.forEach((doc) => {
                    orderList.push({ id: String(doc.id), ...doc.data() });
                });
                orderList.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                UNSEEN_ORDERS = orderList;

                // Refresh main views
                calculateFinanceStats();
                renderOrdersTable();
                renderOrdersSplitLogs();
                renderAnalyticalCharts();
            }, (err) => {
                console.error("Realtime orders sync failed:", err);
            });
        }

        // Firestore Mutations
        async function saveConfigToFirebase() {
            if (!isFirebaseActive) {
                localStorage.setItem('unseen_materials_v2', JSON.stringify(UNSEEN_MATERIALS));
                localStorage.setItem('unseen_colors_v2', JSON.stringify(UNSEEN_COLORS));
                localStorage.setItem('unseen_sizes_v2', JSON.stringify(UNSEEN_SIZES));
                localStorage.setItem('unseen_custom_attrs_v2', JSON.stringify(UNSEEN_CUSTOM_ATTRIBUTES));
                localStorage.setItem('unseen_capacity_v2', UNSEEN_CAPACITY);
                localStorage.setItem('unseen_margin_v2', UNSEEN_MARGIN);
                return;
            }
            try {
                const configDocPath = window.F_API.doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
                await window.F_API.setDoc(configDocPath, {
                    materials: UNSEEN_MATERIALS,
                    colors: UNSEEN_COLORS,
                    sizes: UNSEEN_SIZES,
                    custom_attributes: UNSEEN_CUSTOM_ATTRIBUTES,
                    capacity: UNSEEN_CAPACITY,
                    margin: UNSEEN_MARGIN,
                    master_user: localStorage.getItem('unseen_master_user') || "",
                    master_pass: localStorage.getItem('unseen_master_pass') || ""
                });
            } catch (err) {
                console.error("Error saving config to Firebase:", err);
            }
        }

        async function saveProductToFirebase(product) {
            const prodId = product.id || crypto.randomUUID();
            product.id = prodId;
            if (!product.createdAt) product.createdAt = Date.now();

            if (!isFirebaseActive) {
                syncProductAggregateStock(product);
                const existingIdx = UNSEEN_PRODUCTS.findIndex(p => p.id === prodId);
                if (existingIdx !== -1) {
                    UNSEEN_PRODUCTS[existingIdx] = product;
                } else {
                    UNSEEN_PRODUCTS.push(product);
                }
                localStorage.setItem('unseen_products_v2', JSON.stringify(UNSEEN_PRODUCTS));
                refreshInventoryUI();
                return;
            }
            try {
                const docRef = window.F_API.doc(db, 'artifacts', appId, 'public', 'data', 'products', prodId);
                await window.F_API.setDoc(docRef, product);
            } catch (err) {
                console.error("Error saving product to Firebase:", err);
            }
        }

        async function deleteProductFromFirebase(prodId) {
            if (!isFirebaseActive) {
                UNSEEN_PRODUCTS = UNSEEN_PRODUCTS.filter(p => p.id !== prodId);
                localStorage.setItem('unseen_products_v2', JSON.stringify(UNSEEN_PRODUCTS));
                renderActiveCatalog();
                return;
            }
            try {
                const docRef = window.F_API.doc(db, 'artifacts', appId, 'public', 'data', 'products', prodId);
                await window.F_API.deleteDoc(docRef);
            } catch (err) {
                console.error("Error deleting product from Firebase:", err);
            }
        }

        async function saveOrderToFirebase(order) {
            const ordId = String(order.id || Date.now());
            order.id = ordId;
            if (!order.createdAt) order.createdAt = Date.now();

            if (!isFirebaseActive) {
                const existingIdx = UNSEEN_ORDERS.findIndex(o => String(o.id) === ordId);
                if (existingIdx !== -1) {
                    UNSEEN_ORDERS[existingIdx] = order;
                } else {
                    UNSEEN_ORDERS.push(order);
                }
                localStorage.setItem('unseen_orders_v2', JSON.stringify(UNSEEN_ORDERS));
                calculateFinanceStats();
                renderOrdersTable();
                renderOrdersSplitLogs();
                return;
            }
            try {
                const docRef = window.F_API.doc(db, 'artifacts', appId, 'public', 'data', 'orders', ordId);
                await window.F_API.setDoc(docRef, order);
            } catch (err) {
                console.error("Error saving order to Firebase:", err);
            }
        }

        async function deleteOrderFromFirebase(ordId) {
            const stringId = String(ordId);
            if (!isFirebaseActive) {
                UNSEEN_ORDERS = UNSEEN_ORDERS.filter(o => String(o.id) !== stringId);
                localStorage.setItem('unseen_orders_v2', JSON.stringify(UNSEEN_ORDERS));
                calculateFinanceStats();
                renderOrdersTable();
                renderOrdersSplitLogs();
                return;
            }
            try {
                const docRef = window.F_API.doc(db, 'artifacts', appId, 'public', 'data', 'orders', stringId);
                await window.F_API.deleteDoc(docRef);
            } catch (err) {
                console.error("Error deleting order from Firebase:", err);
            }
        }

        // Toggle Password Inputs Visibility
        function togglePasswordVisibility(inputId, iconId) {
            const input = document.getElementById(inputId);
            const icon = document.getElementById(iconId);
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        }

        // Authentication & Session checking (strictly sessionStorage for Tab-lifetime persistence)
        function checkAtelierAuth() {
            const hasUser = localStorage.getItem('unseen_master_user');
            const isLoggedIn = sessionStorage.getItem('unseen_session_active');
            const authOverlay = document.getElementById('auth-overlay');

            if (!hasUser) {
                // Trigger Registration (Atelier setup)
                authOverlay.classList.remove('hidden');
                document.getElementById('login-view').classList.add('hidden');
                document.getElementById('register-view').classList.remove('hidden');
            } else if (!isLoggedIn) {
                // Trigger Login
                authOverlay.classList.remove('hidden');
                document.getElementById('login-view').classList.remove('hidden');
                document.getElementById('register-view').classList.add('hidden');
            } else {
                // Authenticated
                authOverlay.classList.add('hidden');
                initDashboardSystem();
            }
        }

        // Toggle Auth View Mode
        function toggleAuthMode(toRegister) {
            if (toRegister) {
                document.getElementById('login-view').classList.add('hidden');
                document.getElementById('register-view').classList.remove('hidden');
            } else {
                document.getElementById('login-view').classList.remove('hidden');
                document.getElementById('register-view').classList.add('hidden');
            }
        }

        // Register Account Action
        function handleRegister(e) {
            e.preventDefault();
            const user = document.getElementById('reg-username').value.trim();
            const pass = document.getElementById('reg-password').value.trim();

            if (user.length < 3 || pass.length < 4) {
                triggerToast("Credentials too short! Username (3+ chars) & Password (4+ chars).");
                return;
            }

            localStorage.setItem('unseen_master_user', user);
            localStorage.setItem('unseen_master_pass', pass);
            sessionStorage.setItem('unseen_session_active', 'true');

            saveConfigToFirebase();

            document.getElementById('auth-overlay').classList.add('hidden');
            initDashboardSystem();
            triggerToast("Atelier master password registered successfully.");
        }

        // Log In Action
        function handleLogin(e) {
            e.preventDefault();
            const user = document.getElementById('login-username').value.trim();
            const pass = document.getElementById('login-password').value.trim();

            const savedUser = localStorage.getItem('unseen_master_user');
            const savedPass = localStorage.getItem('unseen_master_pass');

            if (user === savedUser && pass === savedPass) {
                sessionStorage.setItem('unseen_session_active', 'true');
                document.getElementById('auth-overlay').classList.add('hidden');
                initDashboardSystem();
                triggerToast("Workspace unlocked.");
            } else {
                triggerToast("Invalid credentials. Please try again.");
            }
        }

        // Log out & Lock Workspace
        function logoutAtelier() {
            sessionStorage.removeItem('unseen_session_active');
            location.reload();
        }

        // Profile details update 
        function handleProfileUpdate(e) {
            e.preventDefault();
            const user = document.getElementById('profile-username').value.trim();
            const pass = document.getElementById('profile-password').value.trim();

            if (user.length < 3) {
                triggerToast("Username must be at least 3 characters.");
                return;
            }

            localStorage.setItem('unseen_master_user', user);
            if (pass) {
                localStorage.setItem('unseen_master_pass', pass);
            }
            saveConfigToFirebase();
            triggerToast("Security details updated successfully.");
        }

        // Define missing syncButtonStates to toggle Order buttons appropriately
        function syncButtonStates() {
            const btnSidebar = document.getElementById('btn-sidebar-order');
            const btnHeader = document.getElementById('header-order-btn');
            const hasProducts = UNSEEN_PRODUCTS.length > 0;

            if (hasProducts) {
                if (btnSidebar) {
                    btnSidebar.removeAttribute('disabled');
                    btnSidebar.removeAttribute('title');
                    btnSidebar.classList.remove('opacity-50', 'cursor-not-allowed');
                }
                if (btnHeader) {
                    btnHeader.removeAttribute('disabled');
                    btnHeader.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            } else {
                if (btnSidebar) {
                    btnSidebar.setAttribute('disabled', 'true');
                    btnSidebar.setAttribute('title', 'Design products first');
                    btnSidebar.classList.add('opacity-50', 'cursor-not-allowed');
                }
                if (btnHeader) {
                    btnHeader.setAttribute('disabled', 'true');
                    btnHeader.classList.add('opacity-50', 'cursor-not-allowed');
                }
            }
        }

        // Main Refresh Controller
        function initDashboardSystem() {
            calculateFinanceStats();
            renderOrdersTable();
            renderOrdersSplitLogs();
            renderActiveCatalog();
            populateAttributesSettingsPanel();
            populateFilterOptions();
            renderAnalyticalCharts();
            syncButtonStates();

            // Prefill profile values inside Profile Form
            document.getElementById('profile-username').value = localStorage.getItem('unseen_master_user') || "";
            document.getElementById('profile-password').value = "";
        }

        // Populate product options inside the completed list return filters
        function populateFilterOptions() {
            const filterSelect = document.getElementById('completed-filter-product');
            if (!filterSelect) return;
            
            // Retain the 'all' option
            filterSelect.innerHTML = '<option value="all">-- All Pieces --</option>';
            UNSEEN_PRODUCTS.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.innerText = p.name;
                filterSelect.appendChild(opt);
            });
        }

        // Get subset of orders filtered by selected Time Horizon
        function getFilteredOrders() {
            const filterVal = document.getElementById('dashboard-date-filter').value;
            const customInputs = document.getElementById('custom-date-inputs');
            
            if (filterVal === 'custom') {
                customInputs.classList.remove('hidden');
            } else {
                customInputs.classList.add('hidden');
            }
            
            if (filterVal === 'all') {
                return UNSEEN_ORDERS;
            }
            
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            
            return UNSEEN_ORDERS.filter(ord => {
                if (!ord.date) return false; 
                
                const ordDate = new Date(ord.date);
                
                if (filterVal === 'today') {
                    return ord.date === todayStr;
                } else if (filterVal === 'week') {
                    const diffTime = Math.abs(now - ordDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    return diffDays <= 7;
                } else if (filterVal === 'month') {
                    const currentMonth = now.getMonth();
                    const currentYear = now.getFullYear();
                    return ordDate.getMonth() === currentMonth && ordDate.getFullYear() === currentYear;
                } else if (filterVal === 'custom') {
                    const startVal = document.getElementById('filter-start-date').value;
                    const endVal = document.getElementById('filter-end-date').value;
                    if (!startVal || !endVal) return true; 
                    return ord.date >= startVal && ord.date <= endVal;
                }
                return true;
            });
        }

        // Trigger dynamic updates upon date filter change
        function handleDateFilterChange() {
            calculateFinanceStats();
            renderOrdersTable();
            renderAnalyticalCharts();
        }

        // Tab Navigation Controller
        function switchTab(targetTab) {
            const tabs = ['dashboard', 'products', 'orders', 'settings', 'profile'];
            tabs.forEach(tab => {
                const btn = document.getElementById(`btn-tab-${tab}`);
                const content = document.getElementById(`tab-content-${tab}`);
                if (tab === targetTab) {
                    btn.classList.add('bg-white', 'bg-opacity-80', 'font-semibold');
                    btn.classList.remove('hover:bg-white', 'hover:bg-opacity-40');
                    content.classList.remove('hidden');
                } else {
                    btn.classList.remove('bg-white', 'bg-opacity-80', 'font-semibold');
                    btn.classList.add('hover:bg-white', 'hover:bg-opacity-40');
                    content.classList.add('hidden');
                }
            });

            const mainTitle = document.getElementById('page-title');
            const mainSubtitle = document.getElementById('page-subtitle');
            if (targetTab === 'dashboard') {
                mainTitle.innerText = "Dashboard Stats";
                mainSubtitle.innerText = "Atelier production metrics & limited edition insights";
                initDashboardSystem();
            } else if (targetTab === 'products') {
                mainTitle.innerText = "Products Information";
                mainSubtitle.innerText = "Design, track and warehouse limited stock designs";
                populateCatalogFormAttributes();
                renderActiveCatalog();
            } else if (targetTab === 'orders') {
                mainTitle.innerText = "Orders Log";
                mainSubtitle.innerText = "Manage active crafting queues and track successfully completed client deliveries";
                renderOrdersSplitLogs();
                populateFilterOptions();
            } else if (targetTab === 'settings') {
                mainTitle.innerText = "Attributes & Settings";
                mainSubtitle.innerText = "Configure raw options for materials, colors, sizes and metrics";
                populateAttributesSettingsPanel();
            } else if (targetTab === 'profile') {
                mainTitle.innerText = "Profile Settings";
                mainSubtitle.innerText = "Edit master account security credentials";
            }
        }

        // Attribute Settings populating
        function populateAttributesSettingsPanel() {
            // Materials List
            const materialsDiv = document.getElementById('settings-materials-list');
            materialsDiv.innerHTML = '';
            UNSEEN_MATERIALS.forEach((mat, idx) => {
                const item = document.createElement('div');
                item.className = "flex justify-between items-center bg-brand-bg px-3 py-1.5 rounded-xl border border-[#EBE6DD]";
                item.innerHTML = `
                    <span class="text-xs font-semibold text-brand-text-dark">${mat}</span>
                    <div class="flex items-center space-x-2">
                        <button onclick="openEditAttributeModal('materials', ${idx})" class="text-brand-accent hover:text-brand-accent-dark transition" title="Edit Material"><i class="fas fa-edit text-xs"></i></button>
                        <button onclick="deleteMaterial(${idx})" class="text-red-400 hover:text-red-700 transition" title="Delete Material"><i class="fas fa-times-circle"></i></button>
                    </div>
                `;
                materialsDiv.appendChild(item);
            });

            // Colors List
            const colorsDiv = document.getElementById('settings-colors-list');
            colorsDiv.innerHTML = '';
            UNSEEN_COLORS.forEach((color, idx) => {
                const item = document.createElement('div');
                item.className = "flex justify-between items-center bg-brand-bg px-3 py-1.5 rounded-xl border border-[#EBE6DD]";
                item.innerHTML = `
                    <span class="text-xs font-semibold text-brand-text-dark">${color}</span>
                    <div class="flex items-center space-x-2">
                        <button onclick="openEditAttributeModal('colors', ${idx})" class="text-brand-accent hover:text-brand-accent-dark transition" title="Edit Color"><i class="fas fa-edit text-xs"></i></button>
                        <button onclick="deleteColor(${idx})" class="text-red-400 hover:text-red-700 transition" title="Delete Color"><i class="fas fa-times-circle"></i></button>
                    </div>
                `;
                colorsDiv.appendChild(item);
            });

            // Sizes List
            const sizesDiv = document.getElementById('settings-sizes-list');
            sizesDiv.innerHTML = '';
            UNSEEN_SIZES.forEach((size, idx) => {
                const item = document.createElement('div');
                item.className = "flex justify-between items-center bg-brand-bg px-3 py-1.5 rounded-xl border border-[#EBE6DD]";
                item.innerHTML = `
                    <span class="text-xs font-semibold text-brand-text-dark">${size}</span>
                    <div class="flex items-center space-x-2">
                        <button onclick="openEditAttributeModal('sizes', ${idx})" class="text-brand-accent hover:text-brand-accent-dark transition" title="Edit Size"><i class="fas fa-edit text-xs"></i></button>
                        <button onclick="deleteSize(${idx})" class="text-red-400 hover:text-red-700 transition" title="Delete Size"><i class="fas fa-times-circle"></i></button>
                    </div>
                `;
                sizesDiv.appendChild(item);
            });

            // Clean custom components
            const deck = document.getElementById('attributes-deck');
            const existingCustomCards = deck.querySelectorAll('.custom-attr-card');
            existingCustomCards.forEach(card => card.remove());

            // Render each custom attribute as a card
            UNSEEN_CUSTOM_ATTRIBUTES.forEach((attr, idx) => {
                const card = document.createElement('div');
                card.className = "custom-attr-card bg-brand-card p-6 rounded-2xl card-shadow border border-[#EBE6DD] flex flex-col justify-between h-[360px]";
                
                let optsHtml = '';
                attr.options.forEach((opt, optIdx) => {
                    optsHtml += `
                        <div class="flex justify-between items-center bg-[#FAF8F5] px-2.5 py-1.5 rounded-lg border border-[#EBE6DD] text-[11px]">
                            <span class="font-medium text-brand-text-dark">${opt}</span>
                            <div class="flex items-center space-x-1.5">
                                <button onclick="openEditAttributeModal('custom_opt', ${idx}, ${optIdx})" class="text-brand-accent hover:text-brand-accent-dark transition" title="Edit Option"><i class="fas fa-edit text-[10px]"></i></button>
                                <button onclick="deleteCustomAttrOption(${idx}, ${optIdx})" class="text-red-400 hover:text-red-700 transition" title="Delete Option"><i class="fas fa-times text-[10px]"></i></button>
                            </div>
                        </div>
                    `;
                });

                card.innerHTML = `
                    <div>
                        <div class="flex justify-between items-start mb-1">
                            <h3 class="text-md font-bold text-brand-text-dark flex items-center gap-1.5">
                                <i class="fas fa-cube text-brand-accent"></i> ${attr.name}
                            </h3>
                            <div class="flex space-x-2">
                                <button onclick="openEditAttributeModal('custom_attr_name', ${idx})" class="text-brand-accent hover:text-brand-accent-dark text-[11px] font-medium transition" title="Rename Attribute"><i class="fas fa-edit"></i> Edit</button>
                                <button onclick="deleteEntireCustomAttr(${idx})" class="text-red-400 hover:text-red-600 text-[11px] font-medium transition" title="Delete Attribute"><i class="fas fa-trash-alt"></i></button>
                            </div>
                        </div>
                        <p class="text-[10px] text-brand-text-muted mb-4">Dynamically added custom parameter</p>
                        <div class="space-y-1.5 h-[140px] overflow-y-auto mb-4 pr-1">
                            ${optsHtml || '<p class="text-[10px] text-brand-text-muted italic py-4 text-center">No options available. Add one below!</p>'}
                        </div>
                    </div>
                    <div class="border-t border-[#EBE6DD] pt-4">
                        <label class="block text-[10px] font-bold text-brand-text-muted uppercase tracking-wider mb-1">Add Option</label>
                        <div class="flex gap-2">
                            <input type="text" id="newOptInput-${idx}" placeholder="e.g. Value" class="flex-1 p-2 border border-[#DCD5CB] rounded-lg text-xs bg-[#FAF8F5] focus:outline-none">
                            <button onclick="addCustomAttrOption(${idx})" class="bg-brand-accent hover:bg-brand-text-dark text-white px-3 py-2 rounded-lg transition text-xs font-semibold">Add</button>
                        </div>
                    </div>
                `;
                deck.insertBefore(card, deck.lastElementChild);
            });

            document.getElementById('settings-capacity').value = UNSEEN_CAPACITY;
            document.getElementById('settings-margin').value = UNSEEN_MARGIN;

            populateCatalogFormAttributes();
        }

        // --- Product model items: helpers & form UI ---
        function getProductItems(prod) {
            if (prod.items && prod.items.length > 0) return prod.items;
            const colors = prod.colors || [];
            const sizes = prod.sizes || [];
            if (colors.length && sizes.length) {
                const items = [];
                colors.forEach(color => {
                    sizes.forEach(size => {
                        items.push({
                            id: `${color}-${size}`,
                            material: prod.material || '',
                            color,
                            size,
                            quantity: 1,
                            cost: prod.cost || 0
                        });
                    });
                });
                return items;
            }
            if (prod.material || prod.cost) {
                return [{
                    id: 'legacy-1',
                    material: prod.material || '',
                    color: colors[0] || '',
                    size: sizes[0] || '',
                    quantity: parseInt(prod.stock, 10) || 0,
                    cost: prod.cost || 0
                }];
            }
            return [];
        }

        function deriveLegacyFieldsFromItems(items) {
            const materials = [...new Set(items.map(i => i.material).filter(Boolean))];
            const colors = [...new Set(items.map(i => i.color).filter(Boolean))];
            const sizes = [...new Set(items.map(i => i.size).filter(Boolean))];
            const costs = items.map(i => parseFloat(i.cost)).filter(c => !isNaN(c) && c > 0);
            const quantities = items.map(i => parseInt(i.quantity, 10)).filter(q => !isNaN(q) && q >= 0);
            return {
                material: materials.length === 1 ? materials[0] : materials.join(', '),
                colors,
                sizes,
                cost: costs.length ? Math.min(...costs) : 0,
                totalQuantity: quantities.reduce((sum, q) => sum + q, 0)
            };
        }

        function getItemRowQuantity(row) {
            const qty = parseInt(row.querySelector('.prod-item-quantity')?.value, 10);
            return isNaN(qty) || qty < 0 ? 0 : qty;
        }

        function getItemRowSummary(row) {
            const mat = row.querySelector('.prod-item-material')?.value || '';
            const col = row.querySelector('.prod-item-color')?.value || '';
            const sz = row.querySelector('.prod-item-size')?.value || '';
            const qty = getItemRowQuantity(row);
            return { mat, col, sz, qty, summary: `${mat} · ${col} · ${sz}`, qtyLabel: `Qty: ${qty}` };
        }

        function resolveItemCost(product, color, size, material = null) {
            const variant = findProductVariant(product, color, size, material);
            if (variant && parseFloat(variant.cost) > 0) return parseFloat(variant.cost);
            return parseFloat(product.cost) || 0;
        }

        function resolveItemMaterial(product, color, size) {
            const variant = findProductVariant(product, color, size);
            return variant?.material || product.material || '';
        }

        function getPrimaryProductCost(prod) {
            const items = getProductItems(prod);
            const costs = items.map(i => parseFloat(i.cost)).filter(c => !isNaN(c) && c > 0);
            if (costs.length) return Math.min(...costs);
            return parseFloat(prod.cost) || 0;
        }

        // --- Per-variant inventory (Material + Color + Size) ---
        function ensureMutableProductItems(product) {
            if (product.items && product.items.length > 0) {
                product.items = product.items.map(i => ({ ...i }));
                return product.items;
            }
            const derived = getProductItems(product).map(i => ({ ...i }));
            product.items = derived;
            return product.items;
        }

        function syncProductAggregateStock(product) {
            const items = product.items?.length ? product.items : getProductItems(product);
            const total = items.reduce((sum, i) => sum + (parseInt(i.quantity, 10) || 0), 0);
            product.stock = total;
            return total;
        }

        function findProductVariant(product, color, size, material = null) {
            const items = product.items?.length ? product.items : getProductItems(product);
            if (material) {
                const exact = items.find(i => i.material === material && i.color === color && i.size === size);
                if (exact) return exact;
            }
            return items.find(i => i.color === color && i.size === size) || null;
        }

        function getVariantQuantity(product, color, size, material = null) {
            const variant = findProductVariant(product, color, size, material);
            return variant ? (parseInt(variant.quantity, 10) || 0) : 0;
        }

        function isVariantInStock(product, color, size, material = null, amount = 1) {
            return getVariantQuantity(product, color, size, material) >= amount;
        }

        function deductVariantStock(product, color, size, material, amount = 1) {
            ensureMutableProductItems(product);
            const variant = findProductVariant(product, color, size, material);
            if (!variant) {
                return { ok: false, message: 'Variant not found for this selection.' };
            }
            const currentQty = parseInt(variant.quantity, 10) || 0;
            if (currentQty < amount) {
                return { ok: false, message: 'Insufficient stock for this item.' };
            }
            variant.quantity = currentQty - amount;
            syncProductAggregateStock(product);
            return { ok: true, variant };
        }

        function restoreVariantStock(product, color, size, material, amount = 1) {
            ensureMutableProductItems(product);
            let variant = findProductVariant(product, color, size, material);
            if (!variant) {
                variant = {
                    id: `restored-${Date.now()}`,
                    material: material || product.material || '',
                    color,
                    size,
                    quantity: 0,
                    cost: product.cost || 0
                };
                product.items.push(variant);
            }
            variant.quantity = (parseInt(variant.quantity, 10) || 0) + amount;
            syncProductAggregateStock(product);
            return variant;
        }

        function refreshInventoryUI() {
            renderActiveCatalog();
            syncButtonStates();
            renderOrdersTable();
            renderOrdersSplitLogs();
        }

        function getSelectedOrderProduct() {
            const name = document.getElementById('itemProductSelect')?.value;
            return UNSEEN_PRODUCTS.find(p => p.name === name) || null;
        }

        function getSelectedOrderVariant() {
            const product = getSelectedOrderProduct();
            if (!product) return null;
            const color = document.getElementById('orderProductColor')?.value;
            const size = document.getElementById('orderProductSize')?.value;
            const material = document.getElementById('orderProductMaterial')?.value;
            return findProductVariant(product, color, size, material) || findProductVariant(product, color, size);
        }

        function buildSelectOptions(list, selectedVal) {
            if (!list || list.length === 0) {
                return '<option value="">— Configure in Attributes —</option>';
            }
            return list.map(val => `<option value="${val}"${val === selectedVal ? ' selected' : ''}>${val}</option>`).join('');
        }

        function addProductItemRow(prefill = null) {
            const container = document.getElementById('prodItemsContainer');
            if (!container) return;

            prodItemRowSeq += 1;
            const itemId = prefill?.id || `item-${prodItemRowSeq}`;
            if (prefill?.cost) productItemCosts[itemId] = prefill.cost;

            const row = document.createElement('div');
            row.className = 'prod-item-row bg-brand-bg border border-[#DCD5CB] rounded-xl p-3 space-y-2 relative';
            row.dataset.itemId = itemId;

            const matVal = prefill?.material || UNSEEN_MATERIALS[0] || '';
            const colVal = prefill?.color || UNSEEN_COLORS[0] || '';
            const szVal = prefill?.size || UNSEEN_SIZES[0] || '';
            const qtyVal = prefill?.quantity !== undefined ? prefill.quantity : 1;
            const appliedCost = productItemCosts[itemId];
            const costBadge = appliedCost
                ? `<span class="prod-item-cost-badge text-[9px] font-bold text-green-800 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">EGP ${Number(appliedCost).toLocaleString()}</span>`
                : `<span class="prod-item-cost-badge text-[9px] text-brand-text-muted italic">No cost set</span>`;

            row.innerHTML = `
                <div class="flex justify-between items-start gap-2">
                    <span class="prod-item-label text-[10px] font-bold text-brand-accent-dark uppercase tracking-wider">Item</span>
                    <div class="flex items-center gap-2">
                        ${costBadge}
                        <button type="button" onclick="removeProductItemRow('${itemId}')" class="text-red-400 hover:text-red-600 text-xs" title="Remove item"><i class="fas fa-times"></i></button>
                    </div>
                </div>
                <div class="grid grid-cols-1 gap-2">
                    <div>
                        <label class="block text-[10px] font-bold text-brand-text-muted uppercase tracking-wider mb-1">Material *</label>
                        <select class="prod-item-material w-full p-2 border border-[#DCD5CB] rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-accent" required onchange="refreshCostManagementUI()">
                            ${buildSelectOptions(UNSEEN_MATERIALS, matVal)}
                        </select>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold text-brand-text-muted uppercase tracking-wider mb-1">Color *</label>
                            <select class="prod-item-color w-full p-2 border border-[#DCD5CB] rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-accent" required onchange="refreshCostManagementUI()">
                                ${buildSelectOptions(UNSEEN_COLORS, colVal)}
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-brand-text-muted uppercase tracking-wider mb-1">Size *</label>
                            <select class="prod-item-size w-full p-2 border border-[#DCD5CB] rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-accent" required onchange="refreshCostManagementUI()">
                                ${buildSelectOptions(UNSEEN_SIZES, szVal)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-brand-text-muted uppercase tracking-wider mb-1">Quantity *</label>
                        <input type="number" class="prod-item-quantity w-full p-2 border border-[#DCD5CB] rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand-accent font-semibold" required min="1" step="1" value="${qtyVal}" placeholder="e.g. 3" oninput="refreshCostManagementUI()">
                        <p class="text-[9px] text-brand-text-muted mt-0.5">Available stock for this material, color, and size combination.</p>
                    </div>
                </div>
            `;

            container.appendChild(row);
            refreshCostManagementUI();
        }

        function removeProductItemRow(itemId) {
            const container = document.getElementById('prodItemsContainer');
            const rows = container ? container.querySelectorAll('.prod-item-row') : [];
            if (rows.length <= 1) {
                triggerToast("At least one item is required per model.");
                return;
            }
            const row = container.querySelector(`.prod-item-row[data-item-id="${itemId}"]`);
            if (row) row.remove();
            delete productItemCosts[itemId];
            refreshCostManagementUI();
        }

        function refreshProductItemRowOptions() {
            document.querySelectorAll('.prod-item-row').forEach(row => {
                const mat = row.querySelector('.prod-item-material');
                const col = row.querySelector('.prod-item-color');
                const sz = row.querySelector('.prod-item-size');
                if (mat) {
                    const v = mat.value;
                    mat.innerHTML = buildSelectOptions(UNSEEN_MATERIALS, UNSEEN_MATERIALS.includes(v) ? v : UNSEEN_MATERIALS[0]);
                }
                if (col) {
                    const v = col.value;
                    col.innerHTML = buildSelectOptions(UNSEEN_COLORS, UNSEEN_COLORS.includes(v) ? v : UNSEEN_COLORS[0]);
                }
                if (sz) {
                    const v = sz.value;
                    sz.innerHTML = buildSelectOptions(UNSEEN_SIZES, UNSEEN_SIZES.includes(v) ? v : UNSEEN_SIZES[0]);
                }
            });
        }

        function refreshCostManagementUI() {
            const rows = document.querySelectorAll('.prod-item-row');
            const select = document.getElementById('prodCostItemSelect');
            const checklist = document.getElementById('prodCostItemChecklist');
            if (!select || !checklist) return;

            select.innerHTML = '';
            checklist.innerHTML = '';

            rows.forEach((row, idx) => {
                const itemId = row.dataset.itemId;
                const label = `Item ${idx + 1}`;
                row.querySelector('.prod-item-label').innerText = label;

                const { summary, qty, qtyLabel } = getItemRowSummary(row);

                const opt = document.createElement('option');
                opt.value = itemId;
                opt.innerText = `${label} (${qtyLabel})`;
                opt.title = `${summary} — ${qtyLabel}`;
                select.appendChild(opt);

                const cost = productItemCosts[itemId];
                const qtyClass = qty <= 2 ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-brand-accent-dark bg-[#F6F3EE] border-[#DCD5CB]';
                const line = document.createElement('label');
                line.className = 'flex items-center gap-2 text-xs text-brand-text-dark cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-[#EBE6DD] hover:bg-brand-bg transition';
                line.innerHTML = `
                    <input type="checkbox" class="prod-cost-item-cb rounded border-[#DCD5CB] text-brand-accent focus:ring-brand-accent" data-item-id="${itemId}">
                    <span class="font-semibold shrink-0">${label}</span>
                    <span class="text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${qtyClass}">${qtyLabel}</span>
                    <span class="text-[10px] text-brand-text-muted truncate flex-1" title="${summary}">${summary}</span>
                    ${cost ? `<span class="text-[10px] font-bold text-green-800 shrink-0">EGP ${Number(cost).toLocaleString()}</span>` : ''}
                `;
                checklist.appendChild(line);

                const badge = row.querySelector('.prod-item-cost-badge');
                if (badge) {
                    if (cost) {
                        badge.className = 'prod-item-cost-badge text-[9px] font-bold text-green-800 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full';
                        badge.innerText = `EGP ${Number(cost).toLocaleString()}`;
                    } else {
                        badge.className = 'prod-item-cost-badge text-[9px] text-brand-text-muted italic';
                        badge.innerText = 'No cost set';
                    }
                }
            });

            if (rows.length && select.options.length) select.selectedIndex = 0;
        }

        function syncCostDropdownToCheckbox() {
            const select = document.getElementById('prodCostItemSelect');
            const itemId = select?.value;
            if (!itemId) return;
            document.querySelectorAll('.prod-cost-item-cb').forEach(cb => {
                cb.checked = cb.dataset.itemId === itemId;
            });
        }

        function applyPendingProductItemPrice() {
            const price = parseFloat(document.getElementById('prodCostPrice')?.value);
            const checked = document.querySelectorAll('.prod-cost-item-cb:checked');
            if (isNaN(price) || price <= 0 || checked.length === 0) return false;

            checked.forEach(cb => {
                productItemCosts[cb.dataset.itemId] = price;
            });
            refreshCostManagementUI();
            return true;
        }

        function applyPriceToSelectedProductItems() {
            const price = parseFloat(document.getElementById('prodCostPrice')?.value);
            const checked = document.querySelectorAll('.prod-cost-item-cb:checked');

            if (isNaN(price) || price <= 0) {
                triggerToast("Enter a valid price before applying.");
                return;
            }
            if (checked.length === 0) {
                triggerToast("Select at least one item to apply this price.");
                return;
            }

            applyPendingProductItemPrice();
            triggerToast(`Price applied to ${checked.length} item(s).`);
        }

        function collectProductItemsFromForm() {
            return Array.from(document.querySelectorAll('.prod-item-row')).map((row, idx) => {
                const itemId = row.dataset.itemId;
                return {
                    id: itemId,
                    label: `Item ${idx + 1}`,
                    material: row.querySelector('.prod-item-material')?.value || '',
                    color: row.querySelector('.prod-item-color')?.value || '',
                    size: row.querySelector('.prod-item-size')?.value || '',
                    quantity: getItemRowQuantity(row),
                    cost: parseFloat(productItemCosts[itemId]) || 0
                };
            });
        }

        function initNewProductFormItems(forceReset = false) {
            const container = document.getElementById('prodItemsContainer');
            if (!container) return;

            if (!forceReset && container.children.length > 0) {
                refreshProductItemRowOptions();
                refreshCostManagementUI();
                return;
            }

            container.innerHTML = '';
            Object.keys(productItemCosts).forEach(k => delete productItemCosts[k]);
            prodItemRowSeq = 0;

            const priceInput = document.getElementById('prodCostPrice');
            if (priceInput) priceInput.value = '';

            addProductItemRow();
        }

        function resetNewProductForm() {
            document.getElementById('productForm')?.reset();
            document.getElementById('prodImagesPreview').innerHTML = '';
            document.getElementById('prodImages').value = '';
            tempNewProductImages = [];
            initNewProductFormItems(true);
            UNSEEN_CUSTOM_ATTRIBUTES.forEach((attr, idx) => {
                document.querySelectorAll(`input[name="custom-attr-${idx}"]`).forEach(cb => { cb.checked = false; });
            });
        }

        // Build catalog inputs dynamically based on default & custom attributes
        function populateCatalogFormAttributes() {
            const itemsContainer = document.getElementById('prodItemsContainer');
            if (itemsContainer && itemsContainer.children.length > 0) {
                refreshProductItemRowOptions();
                refreshCostManagementUI();
            } else {
                initNewProductFormItems(true);
            }

            // Dynamic User Created Custom Attributes injected into "Design Product" Form
            const formContainer = document.getElementById('dynamic-product-fields');
            formContainer.innerHTML = '';
            UNSEEN_CUSTOM_ATTRIBUTES.forEach((attr, idx) => {
                const blockDiv = document.createElement('div');
                blockDiv.className = "border-t border-[#EBE6DD] pt-4";
                
                let checkHtml = '';
                attr.options.forEach(opt => {
                    checkHtml += `
                        <label class="flex items-center space-x-2 text-xs text-brand-text-dark cursor-pointer hover:text-brand-accent transition">
                            <input type="checkbox" name="custom-attr-${idx}" value="${opt}" class="rounded border-[#DCD5CB] text-brand-accent">
                            <span>${opt}</span>
                        </label>
                    `;
                });

                blockDiv.innerHTML = `
                    <label class="block text-xs font-bold text-brand-text-muted uppercase tracking-wider mb-1.5">${attr.name} (Pick available options) *</label>
                    <div class="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto p-2.5 bg-brand-bg border border-[#DCD5CB] rounded-xl">
                        ${checkHtml || '<p class="col-span-2 text-[10px] text-brand-text-muted italic">Add options for this metric in Attributes page.</p>'}
                    </div>
                `;
                formContainer.appendChild(blockDiv);
            });
        }

        // Attribute Edit Modal Handling
        function openEditAttributeModal(category, index, optIndex = null) {
            activeEditAttrCategory = category;
            activeEditAttrIndex = index;
            activeEditCustomAttrOptionIndex = optIndex;

            const modal = document.getElementById('editAttributeModal');
            const title = document.getElementById('editAttrTitle');
            const input = document.getElementById('editAttrInput');

            let currentVal = "";
            if (category === 'materials') {
                title.innerText = "Edit Material Fabric";
                currentVal = UNSEEN_MATERIALS[index];
            } else if (category === 'colors') {
                title.innerText = "Edit Palette Color";
                currentVal = UNSEEN_COLORS[index];
            } else if (category === 'sizes') {
                title.innerText = "Edit Unique Size";
                currentVal = UNSEEN_SIZES[index];
            } else if (category === 'custom_attr_name') {
                title.innerText = "Rename Custom Metric Attribute";
                currentVal = UNSEEN_CUSTOM_ATTRIBUTES[index].name;
            } else if (category === 'custom_opt') {
                title.innerText = "Edit Custom Attribute Option";
                currentVal = UNSEEN_CUSTOM_ATTRIBUTES[index].options[optIndex];
            }

            input.value = currentVal;
            modal.classList.remove('hidden');
        }

        function closeEditAttributeModal() {
            document.getElementById('editAttributeModal').classList.add('hidden');
            activeEditAttrCategory = null;
            activeEditAttrIndex = null;
            activeEditCustomAttrOptionIndex = null;
        }

        // Apply edits to master settings & Cascade updates downstream to designed products and client orders
        document.getElementById('editAttrSaveBtn').onclick = function() {
            const input = document.getElementById('editAttrInput');
            const newVal = input.value.trim();

            if (!newVal) {
                triggerToast("Value cannot be left blank!");
                return;
            }

            if (activeEditAttrCategory === 'materials') {
                const oldVal = UNSEEN_MATERIALS[activeEditAttrIndex];
                UNSEEN_PRODUCTS.forEach(p => {
                    if (p.material === oldVal) {
                        p.material = newVal;
                        saveProductToFirebase(p);
                    }
                });
                UNSEEN_ORDERS.forEach(o => {
                    if (o.material === oldVal) {
                        o.material = newVal;
                        saveOrderToFirebase(o);
                    }
                });
                UNSEEN_MATERIALS[activeEditAttrIndex] = newVal;

            } else if (activeEditAttrCategory === 'colors') {
                const oldVal = UNSEEN_COLORS[activeEditAttrIndex];
                UNSEEN_PRODUCTS.forEach(p => {
                    if (p.colors.includes(oldVal)) {
                        p.colors = p.colors.map(col => col === oldVal ? newVal : col);
                        saveProductToFirebase(p);
                    }
                });
                UNSEEN_ORDERS.forEach(o => {
                    if (o.color === oldVal) {
                        o.color = newVal;
                        saveOrderToFirebase(o);
                    }
                });
                UNSEEN_COLORS[activeEditAttrIndex] = newVal;

            } else if (activeEditAttrCategory === 'sizes') {
                const oldVal = UNSEEN_SIZES[activeEditAttrIndex];
                UNSEEN_PRODUCTS.forEach(p => {
                    if (p.sizes.includes(oldVal)) {
                        p.sizes = p.sizes.map(sz => sz === oldVal ? newVal : sz);
                        saveProductToFirebase(p);
                    }
                });
                UNSEEN_ORDERS.forEach(o => {
                    if (o.size === oldVal) {
                        o.size = newVal;
                        saveOrderToFirebase(o);
                    }
                });
                UNSEEN_SIZES[activeEditAttrIndex] = newVal;

            } else if (activeEditAttrCategory === 'custom_attr_name') {
                const oldAttr = UNSEEN_CUSTOM_ATTRIBUTES[activeEditAttrIndex];
                const oldName = oldAttr.name;
                UNSEEN_PRODUCTS.forEach(p => {
                    if (p.customAttributes && p.customAttributes[oldName] !== undefined) {
                        p.customAttributes[newVal] = p.customAttributes[oldName];
                        delete p.customAttributes[oldName];
                        saveProductToFirebase(p);
                    }
                });
                UNSEEN_ORDERS.forEach(o => {
                    if (o.customSelections && o.customSelections[oldName] !== undefined) {
                        o.customSelections[newVal] = o.customSelections[oldName];
                        delete o.customSelections[oldName];
                        saveOrderToFirebase(o);
                    }
                });
                oldAttr.name = newVal;

            } else if (activeEditAttrCategory === 'custom_opt') {
                const parentAttr = UNSEEN_CUSTOM_ATTRIBUTES[activeEditAttrIndex];
                const attrName = parentAttr.name;
                const oldOptVal = parentAttr.options[activeEditCustomAttrOptionIndex];

                UNSEEN_PRODUCTS.forEach(p => {
                    if (p.customAttributes && p.customAttributes[attrName] && p.customAttributes[attrName].includes(oldOptVal)) {
                        p.customAttributes[attrName] = p.customAttributes[attrName].map(opt => opt === oldOptVal ? newVal : opt);
                        saveProductToFirebase(p);
                    }
                });
                UNSEEN_ORDERS.forEach(o => {
                    if (o.customSelections && o.customSelections[attrName] === oldOptVal) {
                        o.customSelections[attrName] = newVal;
                        saveOrderToFirebase(o);
                    }
                });

                parentAttr.options[activeEditCustomAttrOptionIndex] = newVal;
            }

            saveConfigToFirebase();
            closeEditAttributeModal();
            populateAttributesSettingsPanel();
            triggerToast("Changes saved & cascaded successfully.");
        }

        // Add options for built-in master attributes
        function addNewMaterial() {
            const val = document.getElementById('newMaterialInput').value.trim();
            if (val) {
                if (UNSEEN_MATERIALS.includes(val)) { return; }
                UNSEEN_MATERIALS.push(val);
                saveConfigToFirebase();
                document.getElementById('newMaterialInput').value = '';
                populateAttributesSettingsPanel();
                triggerToast(`Added fabric: ${val}`);
            }
        }

        function deleteMaterial(idx) {
            if (UNSEEN_MATERIALS.length <= 1) { return; }
            UNSEEN_MATERIALS.splice(idx, 1);
            saveConfigToFirebase();
            populateAttributesSettingsPanel();
        }

        function addNewColor() {
            const val = document.getElementById('newColorInput').value.trim();
            if (val) {
                if (UNSEEN_COLORS.includes(val)) { return; }
                UNSEEN_COLORS.push(val);
                saveConfigToFirebase();
                document.getElementById('newColorInput').value = '';
                populateAttributesSettingsPanel();
                triggerToast(`Added color: ${val}`);
            }
        }

        function deleteColor(idx) {
            if (UNSEEN_COLORS.length <= 1) { return; }
            UNSEEN_COLORS.splice(idx, 1);
            saveConfigToFirebase();
            populateAttributesSettingsPanel();
        }

        function addNewSize() {
            const val = document.getElementById('newSizeInput').value.trim();
            if (val) {
                if (UNSEEN_SIZES.includes(val)) { return; }
                UNSEEN_SIZES.push(val);
                saveConfigToFirebase();
                document.getElementById('newSizeInput').value = '';
                populateAttributesSettingsPanel();
                triggerToast(`Added size: ${val}`);
            }
        }

        function deleteSize(idx) {
            if (UNSEEN_SIZES.length <= 1) { return; }
            UNSEEN_SIZES.splice(idx, 1);
            saveConfigToFirebase();
            populateAttributesSettingsPanel();
        }

        // Dynamic attribute modal controllers
        function openCustomAttrModal() {
            document.getElementById('newMetricName').value = '';
            document.getElementById('newMetricOptions').value = '';
            document.getElementById('customAttrModal').classList.remove('hidden');
        }

        function closeCustomAttrModal() {
            document.getElementById('customAttrModal').classList.add('hidden');
        }

        // Save a brand new dynamically generated custom metric card
        function saveNewCustomAttribute() {
            const name = document.getElementById('newMetricName').value.trim();
            const rawOpts = document.getElementById('newMetricOptions').value.trim();

            if (!name || !rawOpts) {
                triggerToast("Both metric name and initial options are required.");
                return;
            }

            const parsedOptions = rawOpts.split(',').map(item => item.trim()).filter(item => item.length > 0);

            if (parsedOptions.length === 0) {
                triggerToast("Please provide valid comma separated options.");
                return;
            }

            UNSEEN_CUSTOM_ATTRIBUTES.push({
                name: name,
                options: parsedOptions
            });

            saveConfigToFirebase();
            closeCustomAttrModal();
            populateAttributesSettingsPanel();
            triggerToast(`Custom attribute "${name}" added successfully.`);
        }

        function deleteEntireCustomAttr(idx) {
            UNSEEN_CUSTOM_ATTRIBUTES.splice(idx, 1);
            saveConfigToFirebase();
            populateAttributesSettingsPanel();
        }

        // Add dynamic custom options
        function addCustomAttrOption(idx) {
            const val = document.getElementById(`newOptInput-${idx}`).value.trim();
            if (val) {
                if (UNSEEN_CUSTOM_ATTRIBUTES[idx].options.includes(val)) { return; }
                UNSEEN_CUSTOM_ATTRIBUTES[idx].options.push(val);
                saveConfigToFirebase();
                populateAttributesSettingsPanel();
            }
        }

        // Delete specific option inside dynamically made card
        function deleteCustomAttrOption(idx, optIdx) {
            UNSEEN_CUSTOM_ATTRIBUTES[idx].options.splice(optIdx, 1);
            saveConfigToFirebase();
            populateAttributesSettingsPanel();
        }

        // Apply financial metrics change
        function saveGlobalMetrics() {
            const cap = parseFloat(document.getElementById('settings-capacity').value);
            const margin = parseFloat(document.getElementById('settings-margin').value);

            if (isNaN(cap) || cap <= 0 || isNaN(margin) || margin < 0) {
                triggerToast("Provide valid positive numbers.");
                return;
            }

            UNSEEN_CAPACITY = cap;
            UNSEEN_MARGIN = margin;

            saveConfigToFirebase();

            UNSEEN_ORDERS.forEach(ord => {
                const markup = ord.cost * (UNSEEN_MARGIN / 100);
                ord.price = ord.cost + markup;
                saveOrderToFirebase(ord);
            });

            initDashboardSystem();
            triggerToast("Configurations updated & metrics recalculated.");
        }

        // Compress and parse user uploaded images utilizing offline Canvas contexts
        function compressAndLoadImages(inputEl, mode) {
            const files = inputEl.files;
            if (!files || files.length === 0) return;

            const previewContainer = document.getElementById(mode === 'new' ? 'prodImagesPreview' : 'editProdImagesPreview');
            previewContainer.innerHTML = "";

            let localBuffer = [];
            let loadedCount = 0;

            for (let i = 0; i < files.length; i++) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const img = new Image();
                    img.src = e.target.result;
                    img.onload = function() {
                        const canvas = document.createElement('canvas');
                        const max_width = 300; // Optimal scaling to save space
                        const scaleSize = max_width / img.width;
                        canvas.width = max_width;
                        canvas.height = img.height * scaleSize;
                        
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);

                        localBuffer.push(compressedBase64);

                        // Render temporary thumbnail preview
                        const thumb = document.createElement('img');
                        thumb.src = compressedBase64;
                        thumb.className = "w-12 h-12 object-cover rounded-lg border border-[#DCD5CB]";
                        previewContainer.appendChild(thumb);

                        loadedCount++;
                        if (loadedCount === files.length) {
                            if (mode === 'new') {
                                tempNewProductImages = localBuffer;
                            } else {
                                tempEditProductImages = localBuffer;
                            }
                            triggerToast(`${files.length} images processed and scaled.`);
                        }
                    }
                };
                reader.readAsDataURL(files[i]);
            }
        }

        // Compress single feedback proof upload
        function compressAndLoadFeedbackImage(inputEl) {
            const file = inputEl.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.src = e.target.result;
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const max_width = 350;
                    const scaleSize = max_width / img.width;
                    canvas.width = max_width;
                    canvas.height = img.height * scaleSize;
                    
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);

                    tempFeedbackImage = compressedBase64;

                    const previewContainer = document.getElementById('feedbackImagePreviewContainer');
                    const previewImg = document.getElementById('feedbackImagePreview');
                    previewImg.src = compressedBase64;
                    previewContainer.classList.remove('hidden');

                    triggerToast("Proof screenshot processed successfully.");
                }
            };
            reader.readAsDataURL(file);
        }

        // Render Active Catalog in Vertical Linear List (Under each other - Newest to Oldest)
        function renderActiveCatalog() {
            const grid = document.getElementById('active-products-catalog');
            const emptyState = document.getElementById('catalog-empty-state');
            grid.innerHTML = '';

            if (UNSEEN_PRODUCTS.length === 0) {
                emptyState.classList.remove('hidden');
                syncButtonStates();
                return;
            } else {
                emptyState.classList.add('hidden');
            }

            // Reverse to display from newest to oldest
            const chronologicalProducts = [...UNSEEN_PRODUCTS].reverse();

            chronologicalProducts.forEach((prod) => {
                syncProductAggregateStock(prod);
                const baseCost = getPrimaryProductCost(prod);
                const calculatedRetail = baseCost + (baseCost * (UNSEEN_MARGIN / 100));
                const itemCount = getProductItems(prod).length;
                const fabricLabel = itemCount > 1
                    ? `${itemCount} variants`
                    : (prod.material || getProductItems(prod)[0]?.material || '-');

                // Find cover thumbnail image (or use premium placeholder)
                const coverSrc = (prod.images && prod.images.length > 0) ? prod.images[0] : `https://placehold.co/100x100/FAF8F5/302924?text=${encodeURIComponent(prod.name)}`;

                const card = document.createElement('div');
                card.className = "interactive-card w-full bg-brand-card p-5 rounded-2xl border border-[#EBE6DD] card-shadow flex flex-col md:flex-row md:items-center md:justify-between cursor-pointer transition-all duration-300 relative overflow-hidden gap-4";
                card.setAttribute("onclick", `openProductDetailModal('${prod.id}')`);

                card.innerHTML = `
                    <div class="flex-1 flex flex-col md:flex-row md:items-center gap-4">
                        <!-- Product Cover Image -->
                        <img src="${coverSrc}" class="w-20 h-20 object-cover rounded-xl border border-[#EBE6DD] shrink-0" onerror="this.src='https://placehold.co/100x100/FAF8F5/302924?text=Atelier'">
                        
                        <div class="bg-[#FAF8F5] p-3 rounded-xl border border-[#EBE6DD] flex flex-col justify-center items-center shrink-0 w-24 h-20 text-center">
                            <span class="text-[9px] text-brand-text-muted uppercase tracking-wider font-bold">Stock Qty</span>
                            <span class="text-xl font-bold mt-1 ${prod.stock <= 2 ? 'text-red-600' : 'text-green-700'}">${prod.stock}</span>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="text-[9px] tracking-[2px] text-brand-accent uppercase font-bold">ATELIER MODEL</span>
                                ${prod.stock <= 2 ? '<span class="text-[8px] bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full font-bold">Low stock</span>' : ''}
                            </div>
                            <h4 class="font-bold text-brand-text-dark text-md brand-logo mt-0.5">${prod.name}</h4>
                            <p class="text-xs text-brand-text-muted mt-1">
                                <span class="mr-3"><strong class="text-brand-text-dark">Fabric:</strong> ${fabricLabel}</span>
                                <span class="mr-3"><strong class="text-brand-text-dark">Sizes:</strong> ${(prod.sizes || []).join(', ')}</span>
                            </p>
                        </div>
                    </div>

                    <div class="border-t md:border-t-0 md:border-l border-[#EBE6DD] pt-3 md:pt-0 md:pl-6 shrink-0 flex justify-between md:flex-col md:items-end gap-1">
                        <div>
                            <p class="text-[9px] text-brand-text-muted uppercase tracking-wider md:text-right">RETAIL VALUE</p>
                            <span class="text-md font-bold text-green-800">EGP ${calculatedRetail.toLocaleString()}</span>
                        </div>
                        <span class="text-xs text-brand-accent hover:text-brand-text-dark font-semibold transition mt-1">
                            Details <i class="fas fa-chevron-right text-[10px] ml-1"></i>
                        </span>
                    </div>
                `;
                grid.appendChild(card);
            });

            syncButtonStates();
        }

        // Product Detail Modal Presentation popup
        function openProductDetailModal(id) {
            const prod = UNSEEN_PRODUCTS.find(p => p.id === id);
            if (!prod) return;

            document.getElementById('detailModalName').innerText = prod.name;
            const detailItems = getProductItems(prod);
            document.getElementById('detailModalFabric').innerText = detailItems.length > 1
                ? detailItems.map(i => `${i.material} (${i.color}/${i.size})`).join(' · ')
                : (prod.material || detailItems[0]?.material || '-');
            
            syncProductAggregateStock(prod);
            const stockBadge = document.getElementById('detailModalStock');
            stockBadge.innerText = `${prod.stock} Units (all variants)`;
            stockBadge.className = `text-xs font-bold mt-1 ${prod.stock <= 2 ? 'text-red-600' : 'text-green-700'}`;

            // Image gallery builder
            const galleryDiv = document.getElementById('detailModalGallery');
            galleryDiv.innerHTML = '';
            if (prod.images && prod.images.length > 0) {
                prod.images.forEach(imgData => {
                    const imgEl = document.createElement('img');
                    imgEl.src = imgData;
                    imgEl.className = "w-20 h-20 object-cover rounded-xl border border-[#EBE6DD] hover:scale-105 transition cursor-pointer";
                    imgEl.onclick = () => viewProofModal(imgData);
                    galleryDiv.appendChild(imgEl);
                });
            } else {
                galleryDiv.innerHTML = `<p class="text-xs text-brand-text-muted italic">No catalog images added.</p>`;
            }

            // Colors
            const colorsDiv = document.getElementById('detailModalColors');
            const displayColors = prod.colors?.length ? prod.colors : [...new Set(detailItems.map(i => i.color).filter(Boolean))];
            colorsDiv.innerHTML = displayColors.map(col => `
                <span class="bg-[#F2ECE4] text-[10px] text-brand-accent-dark font-medium px-2.5 py-1 rounded-md border border-[#DCD5CB]">${col}</span>
            `).join('') || '<span class="text-[10px] text-brand-text-muted italic">—</span>';

            // Sizes
            const sizesDiv = document.getElementById('detailModalSizes');
            const displaySizes = prod.sizes?.length ? prod.sizes : [...new Set(detailItems.map(i => i.size).filter(Boolean))];
            sizesDiv.innerHTML = displaySizes.map(sz => `
                <span class="bg-brand-accent bg-opacity-15 text-[10px] text-brand-text-dark font-bold px-2.5 py-1 rounded-md border border-[#A39282] border-opacity-20">${sz}</span>
            `).join('') || '<span class="text-[10px] text-brand-text-muted italic">—</span>';

            const existingVariantPanel = document.getElementById('detailModalVariantStock');
            if (existingVariantPanel) existingVariantPanel.remove();
            if (detailItems.length > 0 && sizesDiv.parentElement) {
                const variantPanel = document.createElement('div');
                variantPanel.id = 'detailModalVariantStock';
                variantPanel.className = 'bg-[#FAF8F5] p-3 rounded-xl border border-[#EBE6DD] space-y-1.5 mt-3';
                variantPanel.innerHTML = '<span class="text-[9px] text-brand-text-muted uppercase font-bold tracking-wider block mb-1">Variant Inventory</span>';
                detailItems.forEach(item => {
                    const qty = parseInt(item.quantity, 10) || 0;
                    const row = document.createElement('div');
                    row.className = `text-[10px] flex justify-between gap-2 py-1 border-b border-dashed border-[#EBE6DD] last:border-0 ${qty === 0 ? 'opacity-60' : ''}`;
                    row.innerHTML = `
                        <span class="text-brand-text-dark font-medium">${item.material} · ${item.color} · ${item.size}</span>
                        <span class="font-bold ${qty === 0 ? 'text-red-600' : 'text-green-800'}">${qty === 0 ? 'Out of Stock' : qty + ' left'}</span>
                    `;
                    variantPanel.appendChild(row);
                });
                sizesDiv.parentElement.insertBefore(variantPanel, sizesDiv.nextSibling);
            }

            // Dynamic custom specifications
            const customDiv = document.getElementById('detailModalCustomAttrs');
            customDiv.innerHTML = '<span class="text-[9px] text-brand-text-muted uppercase font-bold tracking-wider block mb-2">DYNAMIC CUSTOM ATTRIBUTES</span>';
            
            let hasCustom = false;
            if (prod.customAttributes && Object.keys(prod.customAttributes).length > 0) {
                for (const [key, values] of Object.entries(prod.customAttributes)) {
                    if (values && values.length > 0) {
                        hasCustom = true;
                        const row = document.createElement('div');
                        row.className = "text-xs border-b border-[#EBE6DD] border-dashed pb-2 last:border-0";
                        row.innerHTML = `
                            <strong class="text-brand-text-dark text-[10px] uppercase tracking-wider block mb-1">${key}</strong>
                            <div class="flex flex-wrap gap-1">
                                ${values.map(v => `<span class="bg-stone-100 text-[10px] text-stone-700 px-2 py-0.5 rounded border border-stone-200">${v}</span>`).join('')}
                            </div>
                        `;
                        customDiv.appendChild(row);
                    }
                }
            }
            if (!hasCustom) {
                customDiv.innerHTML += '<p class="text-[10px] text-brand-text-muted italic">No custom parameters configured.</p>';
            }

            // Financial Breakdowns
            const cost = getPrimaryProductCost(prod);
            const markup = cost * (UNSEEN_MARGIN / 100);
            const retail = cost + markup;

            document.getElementById('detailModalCost').innerText = `EGP ${cost.toLocaleString()}`;
            document.getElementById('detailModalMarkup').innerText = `EGP ${markup.toLocaleString()}`;
            document.getElementById('detailModalRetail').innerText = `EGP ${retail.toLocaleString()}`;

            // Attach dynamic delete trigger
            const delBtn = document.getElementById('detailModalDeleteBtn');
            delBtn.onclick = function() {
                deleteProductFromFirebase(prod.id);
                closeProductDetailModal();
            };

            // Attach dynamic edit trigger
            const editBtn = document.getElementById('detailModalEditBtn');
            editBtn.onclick = function() {
                closeProductDetailModal();
                openEditProductModal(prod.id);
            };

            document.getElementById('productDetailModal').classList.remove('hidden');
        }

        function closeProductDetailModal() {
            document.getElementById('productDetailModal').classList.add('hidden');
        }

        // Edit Product Model Panel popup
        function openEditProductModal(id) {
            const prod = UNSEEN_PRODUCTS.find(p => p.id === id);
            if (!prod) return;

            document.getElementById('editProdIndex').value = id;
            document.getElementById('editProdName').value = prod.name;
            document.getElementById('editProdCost').value = prod.cost;
            document.getElementById('editProdStock').value = prod.stock;

            tempEditProductImages = prod.images || [];
            document.getElementById('editProdImagesPreview').innerHTML = "";
            document.getElementById('editProdImages').value = "";

            // Pre-load current thumbnails
            tempEditProductImages.forEach(img => {
                const thumb = document.createElement('img');
                thumb.src = img;
                thumb.className = "w-12 h-12 object-cover rounded-lg border border-[#DCD5CB]";
                document.getElementById('editProdImagesPreview').appendChild(thumb);
            });

            // Load Materials
            const matSelect = document.getElementById('editProdMaterial');
            matSelect.innerHTML = '';
            UNSEEN_MATERIALS.forEach(mat => {
                const opt = document.createElement('option');
                opt.value = mat;
                opt.innerText = mat;
                if (mat === prod.material) opt.selected = true;
                matSelect.appendChild(opt);
            });

            // Load Colors Checkboxes
            const colorsContainer = document.getElementById('editProdColorsContainer');
            colorsContainer.innerHTML = '';
            UNSEEN_COLORS.forEach(color => {
                const isChecked = prod.colors.includes(color) ? 'checked' : '';
                const item = document.createElement('label');
                item.className = "flex items-center space-x-2 text-xs text-brand-text-dark cursor-pointer";
                item.innerHTML = `
                    <input type="checkbox" name="editProdColors" value="${color}" ${isChecked} class="rounded border-[#DCD5CB] text-brand-accent">
                    <span>${color}</span>
                `;
                colorsContainer.appendChild(item);
            });

            // Load Sizes Checkboxes
            const sizesContainer = document.getElementById('editProdSizesContainer');
            sizesContainer.innerHTML = '';
            UNSEEN_SIZES.forEach(size => {
                const isChecked = prod.sizes.includes(size) ? 'checked' : '';
                const item = document.createElement('label');
                item.className = "flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-[#DCD5CB] rounded-lg text-xs font-bold cursor-pointer";
                item.innerHTML = `
                    <input type="checkbox" name="editProdSizes" value="${size}" ${isChecked} class="rounded border-[#DCD5CB] text-brand-accent">
                    <span>${size}</span>
                `;
                sizesContainer.appendChild(item);
            });

            // Dynamic User Created Custom Attributes inside Edit Modal
            const formContainer = document.getElementById('edit-dynamic-product-fields');
            formContainer.innerHTML = '';
            UNSEEN_CUSTOM_ATTRIBUTES.forEach((attr, attrIdx) => {
                const blockDiv = document.createElement('div');
                blockDiv.className = "border-t border-[#EBE6DD] pt-4";
                
                let checkHtml = '';
                const currentSelections = prod.customAttributes ? (prod.customAttributes[attr.name] || []) : [];

                attr.options.forEach(opt => {
                    const isChecked = currentSelections.includes(opt) ? 'checked' : '';
                    checkHtml += `
                        <label class="flex items-center space-x-2 text-xs text-brand-text-dark cursor-pointer">
                            <input type="checkbox" name="edit-custom-attr-${attrIdx}" value="${opt}" ${isChecked} class="rounded border-[#DCD5CB] text-brand-accent">
                            <span>${opt}</span>
                        </label>
                    `;
                });

                blockDiv.innerHTML = `
                    <label class="block text-xs font-bold text-brand-text-muted uppercase tracking-wider mb-1.5">${attr.name} *</label>
                    <div class="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto p-2.5 bg-brand-bg border border-[#DCD5CB] rounded-xl">
                        ${checkHtml || '<p class="col-span-2 text-[10px] text-brand-text-muted italic">No options available.</p>'}
                    </div>
                `;
                formContainer.appendChild(blockDiv);
            });

            document.getElementById('editProductModal').classList.remove('hidden');
        }

        function closeEditProductModal() {
            document.getElementById('editProductModal').classList.add('hidden');
        }

        // Apply edits to designed product
        function handleProductUpdateSubmit(event) {
            event.preventDefault();

            const id = document.getElementById('editProdIndex').value;
            const name = document.getElementById('editProdName').value.trim();
            const material = document.getElementById('editProdMaterial').value;
            const cost = parseFloat(document.getElementById('editProdCost').value);
            const stock = parseInt(document.getElementById('editProdStock').value);

            const checkedColors = Array.from(document.querySelectorAll('input[name="editProdColors"]:checked')).map(cb => cb.value);
            const checkedSizes = Array.from(document.querySelectorAll('input[name="editProdSizes"]:checked')).map(cb => cb.value);

            if (checkedColors.length === 0 || checkedSizes.length === 0) {
                triggerToast("Select at least 1 size and 1 color.");
                return;
            }

            let customAttrs = {};
            UNSEEN_CUSTOM_ATTRIBUTES.forEach((attr, attrIdx) => {
                const picked = Array.from(document.querySelectorAll(`input[name="edit-custom-attr-${attrIdx}"]:checked`)).map(cb => cb.value);
                customAttrs[attr.name] = picked;
            });

            const originalProduct = UNSEEN_PRODUCTS.find(p => p.id === id);
            const oldName = originalProduct ? originalProduct.name : "";

            UNSEEN_ORDERS.forEach(o => {
                if (o.product === oldName) {
                    o.product = name;
                    o.cost = cost;
                    o.price = cost + (cost * (UNSEEN_MARGIN / 100));
                    saveOrderToFirebase(o);
                }
            });

            const updatedProduct = {
                id: id,
                name: name,
                material: material,
                colors: checkedColors,
                sizes: checkedSizes,
                cost: cost,
                stock: stock,
                items: originalProduct?.items,
                customAttributes: customAttrs,
                images: tempEditProductImages,
                createdAt: originalProduct ? (originalProduct.createdAt || Date.now()) : Date.now()
            };

            saveProductToFirebase(updatedProduct);
            closeEditProductModal();
            triggerToast(`Catalog details for "${name}" updated.`);
        }

        // Handle addition of a designed product in active store catalog
        function handleProductSubmit(event) {
            event.preventDefault();

            applyPendingProductItemPrice();

            const name = document.getElementById('prodName').value.trim();
            const items = collectProductItemsFromForm();

            if (items.length === 0) {
                triggerToast("Add at least one item to this model.");
                return;
            }

            const incomplete = items.find(i => !i.material || !i.color || !i.size);
            if (incomplete) {
                triggerToast("Each item needs material, color, and size.");
                return;
            }

            const invalidQty = items.find(i => i.quantity === undefined || i.quantity === null || isNaN(i.quantity) || i.quantity < 1);
            if (invalidQty) {
                triggerToast("Each variant needs a quantity of at least 1 unit.");
                return;
            }

            const missingCost = items.filter(i => !i.cost || i.cost <= 0);
            if (missingCost.length > 0) {
                triggerToast("Set production cost for every item via Cost Management.");
                return;
            }

            const keys = items.map(i => `${i.material}|${i.color}|${i.size}`);
            if (new Set(keys).size !== keys.length) {
                triggerToast("Duplicate item combinations are not allowed.");
                return;
            }

            let productCustomAttributes = {};
            UNSEEN_CUSTOM_ATTRIBUTES.forEach((attr, idx) => {
                const pickedOptions = Array.from(document.querySelectorAll(`input[name="custom-attr-${idx}"]:checked`)).map(cb => cb.value);
                productCustomAttributes[attr.name] = pickedOptions;
            });

            const legacy = deriveLegacyFieldsFromItems(items);
            const totalUnits = legacy.totalQuantity;

            const newProduct = {
                id: crypto.randomUUID(),
                name: name,
                items: items,
                material: legacy.material,
                colors: legacy.colors,
                sizes: legacy.sizes,
                cost: legacy.cost,
                stock: totalUnits,
                customAttributes: productCustomAttributes,
                images: tempNewProductImages,
                createdAt: Date.now()
            };

            saveProductToFirebase(newProduct);
            resetNewProductForm();
            const unitsLabel = totalUnits === 1 ? '1 unit' : `${totalUnits} units`;
            triggerToast(`Model "${name}" saved with ${items.length} variant(s) (${unitsLabel} total).`);
        }

        // Recalculating metrics and financial statuses (Only delivered completed orders compute margins)
        function calculateFinanceStats() {
            let sales = 0;
            let cost = 0;
            
            // Apply Date Filter to orders logic
            const targetOrders = getFilteredOrders();
            
            // Only counting status 'delivered' (Completed) in profits/revenue
            const deliveredOrders = targetOrders.filter(ord => ord.status === 'delivered');
            let deliveredCount = deliveredOrders.length;

            deliveredOrders.forEach(ord => {
                sales += parseFloat(ord.price);
                cost += parseFloat(ord.cost);
            });

            const profit = sales - cost;

            document.getElementById('stat-orders').innerText = `${deliveredCount} Completed`;
            document.getElementById('stat-sales').innerText = `EGP ${sales.toLocaleString()}`;
            document.getElementById('stat-profits').innerText = `EGP ${profit.toLocaleString()}`;
            document.getElementById('profit-margin-label').innerHTML = `<i class="fas fa-arrow-up mr-0.5"></i> Margin: +${UNSEEN_MARGIN}% markup`;

            // Active (pending) orders count within filter calculates weekly workshop backlog limit
            const activeOrdersCount = targetOrders.filter(ord => ord.status === 'active' || !ord.status).length;
            document.getElementById('stat-production-title').innerText = `Backlog Load (Max Limit: ${UNSEEN_CAPACITY})`;
            
            const prodCard = document.getElementById('stat-production-card');
            const prodIconBg = document.getElementById('stat-production-icon-bg');
            const prodIcon = document.getElementById('stat-production-icon');
            const gapTitle = document.getElementById('stat-gap');
            const gapDesc = document.getElementById('stat-gap-desc');

            if (activeOrdersCount === 0) {
                prodCard.className = "bg-brand-card p-6 rounded-2xl card-shadow border border-[#EBE6DD]";
                prodIconBg.className = "bg-[#F6F3EE] p-3 rounded-xl text-brand-accent";
                prodIcon.className = "fas fa-check-circle text-lg";
                gapTitle.innerText = "No Pending Queue";
                gapTitle.className = "text-2xl font-bold text-brand-text-dark";
                gapDesc.innerText = "Weekly limit stable";
                gapDesc.className = "text-[11px] text-brand-text-muted mt-2";
            } else if (activeOrdersCount > UNSEEN_CAPACITY) {
                let diff = activeOrdersCount - UNSEEN_CAPACITY;
                prodCard.className = "bg-red-50 p-6 rounded-2xl card-shadow border border-red-200 transition-all duration-300";
                prodIconBg.className = "bg-red-100 p-3 rounded-xl text-red-600";
                prodIcon.className = "fas fa-exclamation-triangle text-lg";
                gapTitle.innerText = `${diff} Piece Overload`;
                gapTitle.className = "text-2xl font-bold text-red-700";
                gapDesc.innerText = `Pending queue exceeds weekly capacity limits (${UNSEEN_CAPACITY})!`;
                gapDesc.className = "text-[11px] text-red-600 mt-2 font-semibold";
            } else {
                let capacityRoom = UNSEEN_CAPACITY - activeOrdersCount;
                prodCard.className = "bg-green-50 p-6 rounded-2xl card-shadow border border-green-200 transition-all duration-300";
                prodIconBg.className = "bg-green-100 p-3 rounded-xl text-green-700";
                prodIcon.className = "fas fa-check-circle text-lg";
                gapTitle.innerText = "Stable Capacity";
                gapTitle.className = "text-2xl font-bold text-green-800";
                gapDesc.innerText = `${capacityRoom} pieces remaining within safety bounds`;
                gapDesc.className = "text-[11px] text-green-700 mt-2 font-medium";
            }

            // Calculate Best Seller & Top Rated Highlight items for active period
            calculateAtelierHighlights(targetOrders);
        }

        // Calculate and display Best Seller and Top Rated items based on reviews & sales counts
        function calculateAtelierHighlights(targetOrders) {
            const bsNameEl = document.getElementById('highlight-bestseller-name');
            const bsStatsEl = document.getElementById('highlight-bestseller-stats');
            const trNameEl = document.getElementById('highlight-toprated-name');
            const trStarsEl = document.getElementById('highlight-toprated-stars');
            const trStatsEl = document.getElementById('highlight-toprated-stats');

            const deliveredOrders = targetOrders.filter(o => o.status === 'delivered');

            if (deliveredOrders.length === 0) {
                bsNameEl.innerText = "No Sales";
                bsStatsEl.innerText = "Deliver orders to populate metrics";
                trNameEl.innerText = "No Feedbacks";
                trStarsEl.innerHTML = "";
                trStatsEl.innerText = "No customer feedbacks logged yet";
                return;
            }

            // Group by Product name and sum quantities (Best Seller)
            let productSales = {};
            deliveredOrders.forEach(ord => {
                productSales[ord.product] = (productSales[ord.product] || 0) + 1;
            });

            let bestProduct = "";
            let maxSales = 0;
            for (const [prod, qty] of Object.entries(productSales)) {
                if (qty > maxSales) {
                    maxSales = qty;
                    bestProduct = prod;
                }
            }

            if (bestProduct) {
                bsNameEl.innerText = bestProduct;
                bsStatsEl.innerText = `${maxSales} client pieces shipped during period`;
            } else {
                bsNameEl.innerText = "No Sales";
                bsStatsEl.innerText = "Deliver orders to populate metrics";
            }

            // Group by Product and calculate Average Rating based on Feedbacks (Top Rated)
            let productRatings = {};
            deliveredOrders.forEach(ord => {
                if (ord.feedback && ord.feedback.rating) {
                    if (!productRatings[ord.product]) {
                        productRatings[ord.product] = { sum: 0, count: 0 };
                    }
                    productRatings[ord.product].sum += ord.feedback.rating;
                    productRatings[ord.product].count++;
                }
            });

            let topRatedProduct = "";
            let highestAvg = 0;
            let totalFeedbacksForTop = 0;

            for (const [prod, data] of Object.entries(productRatings)) {
                const avg = data.sum / data.count;
                if (avg > highestAvg) {
                    highestAvg = avg;
                    topRatedProduct = prod;
                    totalFeedbacksForTop = data.count;
                }
            }

            if (topRatedProduct && highestAvg > 0) {
                trNameEl.innerText = topRatedProduct;
                trStatsEl.innerText = `Average score: ${highestAvg.toFixed(1)}/5.0 (${totalFeedbacksForTop} reviews)`;
                
                // Render Star Icons dynamically
                trStarsEl.innerHTML = "";
                const fullStars = Math.round(highestAvg);
                for (let i = 1; i <= 5; i++) {
                    const star = document.createElement('i');
                    star.className = i <= fullStars ? "fas fa-star" : "far fa-star";
                    trStarsEl.appendChild(star);
                }
            } else {
                trNameEl.innerText = "No Feedbacks";
                trStarsEl.innerHTML = "";
                trStatsEl.innerText = "Awaiting first rating during period";
            }
        }

        // Render Active Order tables inside the Dashboard Quick Reference Log (Filtered by Date)
        function renderOrdersTable() {
            const tBody = document.getElementById('dashboard-orders-table-body');
            const emptyState = document.getElementById('dashboard-orders-empty-state');
            tBody.innerHTML = '';

            const targetOrders = getFilteredOrders();
            // Filter Active (Pending delivery) orders
            const activeOrders = targetOrders.filter(ord => ord.status === 'active' || !ord.status);

            if (activeOrders.length === 0) {
                emptyState.classList.remove('hidden');
                return;
            } else {
                emptyState.classList.add('hidden');
            }

            const revOrders = [...activeOrders].reverse();

            revOrders.forEach(ord => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-brand-bg transition-colors";

                let specsDetail = `<span class="inline-block bg-[#EFECE6] text-brand-accent-dark px-2 py-0.5 rounded text-[10px] font-bold">${ord.size}</span>`;
                specsDetail += `<span class="text-brand-text-muted ml-2 text-[10px] font-medium">${ord.color}</span>`;
                
                if (ord.customSelections) {
                    for (const [key, val] of Object.entries(ord.customSelections)) {
                        specsDetail += `<div class="text-[9px] text-brand-text-muted mt-0.5 font-bold">${key}: <span class="text-brand-accent-dark">${val}</span></div>`;
                    }
                }

                tr.innerHTML = `
                    <td class="p-3">
                        <div class="font-bold text-brand-text-dark text-xs">${ord.name}</div>
                        <div class="text-[10px] text-brand-text-muted mt-0.5">${ord.phone}</div>
                    </td>
                    <td class="p-3 font-semibold text-brand-text-dark text-xs">${ord.product}</td>
                    <td class="p-3 text-xs text-brand-text-muted">${ord.material}</td>
                    <td class="p-3 text-xs">
                        ${specsDetail}
                    </td>
                    <td class="p-3 text-right font-bold text-green-800 text-xs">EGP ${parseFloat(ord.price).toLocaleString()}</td>
                    <td class="p-3 text-center">
                        <div class="flex items-center justify-center space-x-2">
                            <button onclick="markOrderAsDelivered('${ord.id}')" class="text-green-500 hover:text-green-700 transition p-1" title="Mark as Delivered">
                                <i class="fas fa-check-circle text-sm"></i>
                            </button>
                            <button onclick="cancelOrderRecord('${ord.id}')" class="text-red-400 hover:text-red-700 transition p-1" title="Cancel Order">
                                <i class="fas fa-times-circle text-xs"></i>
                            </button>
                        </div>
                    </td>
                `;
                tBody.appendChild(tr);
            });
        }

        // Render Partitioned Logs inside the dedicated "Orders" Tab
        function renderOrdersSplitLogs() {
            // Segment 1: Active Pending Orders
            const activeTbody = document.getElementById('orders-active-tbody');
            const activeEmpty = document.getElementById('orders-active-empty');
            if (activeTbody) activeTbody.innerHTML = '';

            const activeOrders = UNSEEN_ORDERS.filter(o => o.status === 'active' || !o.status);
            if (activeOrders.length === 0) {
                if (activeEmpty) activeEmpty.classList.remove('hidden');
            } else {
                if (activeEmpty) activeEmpty.classList.add('hidden');
                [...activeOrders].reverse().forEach(ord => {
                    const tr = document.createElement('tr');
                    tr.className = "hover:bg-brand-bg transition-colors";

                    let specsDetail = `<span class="inline-block bg-[#EFECE6] text-brand-accent-dark px-2 py-0.5 rounded text-[10px] font-bold">${ord.size}</span>`;
                    specsDetail += `<span class="text-brand-text-muted ml-2 text-[10px] font-medium">${ord.color}</span>`;
                    
                    if (ord.customSelections) {
                        for (const [key, val] of Object.entries(ord.customSelections)) {
                            specsDetail += `<div class="text-[9px] text-brand-text-muted mt-0.5 font-bold">${key}: <span class="text-brand-accent-dark">${val}</span></div>`;
                        }
                    }

                    tr.innerHTML = `
                        <td class="p-3 text-brand-text-muted font-semibold text-xs">${ord.date || '-'}</td>
                        <td class="p-3 font-semibold text-brand-text-dark">${ord.name}<div class="text-[10px] text-brand-text-muted mt-0.5">${ord.phone}</div></td>
                        <td class="p-3 font-semibold text-brand-text-dark">${ord.product}</td>
                        <td class="p-3 text-brand-text-muted">${ord.material}</td>
                        <td class="p-3">${specsDetail}</td>
                        <td class="p-3 text-brand-text-muted font-medium">${ord.address || '-'}</td>
                        <td class="p-3 text-right font-bold text-green-800">EGP ${parseFloat(ord.price).toLocaleString()}</td>
                        <td class="p-3 text-center">
                            <div class="flex items-center justify-center space-x-2.5">
                                <button onclick="markOrderAsDelivered('${ord.id}')" class="text-green-500 hover:text-green-700 transition font-semibold flex items-center gap-1 bg-green-50 px-2 py-1 rounded-md border border-green-100" title="Deliver Item">
                                    <i class="fas fa-check text-[10px]"></i> Deliver
                                </button>
                                <button onclick="cancelOrderRecord('${ord.id}')" class="text-red-400 hover:text-red-700 transition p-1" title="Cancel Order">
                                    <span class="text-[10px] bg-red-50 text-red-600 px-2 py-1 rounded-md border border-red-100 hover:bg-red-100">Cancel</span>
                                </button>
                            </div>
                        </td>
                    `;
                    if (activeTbody) activeTbody.appendChild(tr);
                });
            }

            // Segment 2: Completed Delivered Orders with Filters & Feedbacks
            const completedTbody = document.getElementById('orders-completed-tbody');
            const completedEmpty = document.getElementById('orders-completed-empty');
            if (completedTbody) completedTbody.innerHTML = '';

            const completedSearchEl = document.getElementById('completed-search-name');
            const compSearchName = completedSearchEl ? completedSearchEl.value.trim().toLowerCase() : '';
            const completedFilterEl = document.getElementById('completed-filter-product');
            const compFilterProduct = completedFilterEl ? completedFilterEl.value : 'all';

            const completedOrders = UNSEEN_ORDERS.filter(o => o.status === 'delivered');
            
            // Apply Live Filtering on client name search and model selector
            const filteredCompleted = completedOrders.filter(o => {
                const matchesName = o.name.toLowerCase().includes(compSearchName);
                const matchesProduct = (compFilterProduct === 'all') || (o.product === compFilterProduct);
                return matchesName && matchesProduct;
            });

            if (filteredCompleted.length === 0) {
                if (completedEmpty) completedEmpty.classList.remove('hidden');
            } else {
                if (completedEmpty) completedEmpty.classList.add('hidden');
                // Sorted chronologically from newest to oldest
                [...filteredCompleted].reverse().forEach(ord => {
                    const tr = document.createElement('tr');
                    tr.className = "hover:bg-[#FDFCFB] transition-colors bg-[#FAF9F6]";

                    let specsDetail = `<span class="inline-block bg-[#EFECE6] text-brand-accent-dark px-2 py-0.5 rounded text-[10px] font-bold">${ord.size}</span>`;
                    specsDetail += `<span class="text-brand-text-muted ml-2 text-[10px] font-medium">${ord.color}</span>`;
                    
                    if (ord.customSelections) {
                        for (const [key, val] of Object.entries(ord.customSelections)) {
                            specsDetail += `<div class="text-[9px] text-brand-text-muted mt-0.5 font-bold">${key}: <span class="text-brand-accent-dark">${val}</span></div>`;
                        }
                    }

                    // Dynamic feedback button renderer
                    let feedbackBtnHtml = '';
                    if (ord.feedback) {
                        // Display Rating Score badge
                        feedbackBtnHtml = `
                            <button onclick="openFeedbackModal('${ord.id}')" class="text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 px-2.5 py-1.5 rounded-lg border border-amber-200 transition" title="View Feedback Details">
                                <i class="fas fa-star mr-1"></i> ${ord.feedback.rating}.0 / 5
                            </button>
                        `;
                    } else {
                        feedbackBtnHtml = `
                            <button onclick="openFeedbackModal('${ord.id}')" class="text-xs font-semibold bg-[#FAF8F5] hover:bg-stone-100 text-brand-text-dark px-2.5 py-1.5 rounded-lg border border-[#DCD5CB] transition">
                                <i class="far fa-star mr-1 text-brand-accent"></i> Add Feedback
                            </button>
                        `;
                    }

                    tr.innerHTML = `
                        <td class="p-3 text-brand-text-muted font-semibold text-xs">${ord.deliveredDate || ord.date || '-'}</td>
                        <td class="p-3 font-bold text-stone-700">${ord.name}<div class="text-[10px] text-brand-text-muted mt-0.5">${ord.phone}</div></td>
                        <td class="p-3 font-semibold text-stone-700">${ord.product}</td>
                        <td class="p-3 text-brand-text-muted">${ord.material}</td>
                        <td class="p-3">${specsDetail}</td>
                        <td class="p-3 text-brand-text-muted font-medium">${ord.address || '-'}</td>
                        <td class="p-3 text-right font-bold text-green-800">EGP ${parseFloat(ord.price).toLocaleString()}</td>
                        <td class="p-3 text-center">
                            <div class="flex items-center justify-center gap-2">
                                ${feedbackBtnHtml}
                                <button onclick="openReturnModal('${ord.id}')" class="text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-brand-text-dark px-2.5 py-1.5 rounded-lg border border-stone-200 transition">
                                    <i class="fas fa-undo mr-1"></i> Return Item
                                </button>
                            </div>
                        </td>
                    `;
                    if (completedTbody) completedTbody.appendChild(tr);
                });
            }

            // Segment 3: Returned & Refunded Orders with Documentation Checkbox & Screenshot proofing
            const returnedTbody = document.getElementById('orders-returned-tbody');
            const returnedEmpty = document.getElementById('orders-returned-empty');
            if (returnedTbody) returnedTbody.innerHTML = '';

            const returnedOrders = UNSEEN_ORDERS.filter(o => o.status === 'returned');
            if (returnedOrders.length === 0) {
                if (returnedEmpty) returnedEmpty.classList.remove('hidden');
            } else {
                if (returnedEmpty) returnedEmpty.classList.add('hidden');
                [...returnedOrders].reverse().forEach(ord => {
                    const tr = document.createElement('tr');
                    tr.className = "hover:bg-red-50 hover:bg-opacity-20 transition-colors bg-stone-50";

                    let specsDetail = `<span class="inline-block bg-[#EFECE6] text-brand-accent-dark px-2 py-0.5 rounded text-[10px] font-bold">${ord.size}</span>`;
                    specsDetail += `<span class="text-brand-text-muted ml-2 text-[10px] font-medium">${ord.color}</span>`;
                    
                    if (ord.customSelections) {
                        for (const [key, val] of Object.entries(ord.customSelections)) {
                            specsDetail += `<div class="text-[9px] text-brand-text-muted mt-0.5 font-bold">${key}: <span class="text-brand-accent-dark">${val}</span></div>`;
                        }
                    }

                    // Build dynamic upload / view screenshot button
                    let proofHtml = '';
                    if (ord.refundProof) {
                        proofHtml = `
                            <div class="flex items-center justify-center gap-2">
                                <img src="${ord.refundProof}" onclick="viewProofModal('${ord.refundProof}')" class="w-8 h-8 rounded border border-brand-accent object-cover cursor-pointer hover:opacity-80 transition" title="View Instapay/WA Receipt">
                                <button onclick="deleteRefundProof('${ord.id}')" class="text-red-500 hover:text-red-700 text-xs" title="Delete Screenshot"><i class="fas fa-trash-alt"></i></button>
                            </div>
                        `;
                    } else {
                        proofHtml = `
                            <div class="flex items-center justify-center">
                                <label class="cursor-pointer bg-[#F6F3EE] hover:bg-brand-sidebar text-brand-text-dark px-2.5 py-1 rounded border border-[#DCD5CB] text-[10px] font-semibold transition">
                                    <i class="fas fa-upload mr-1 text-brand-accent"></i> Upload Proof
                                    <input type="file" accept="image/*" class="hidden" onchange="handleImageUpload(event, '${ord.id}')">
                                </label>
                            </div>
                        `;
                    }

                    tr.innerHTML = `
                        <td class="p-3 text-brand-text-muted font-semibold text-xs">${ord.returnDate || '-'}</td>
                        <td class="p-3 font-bold text-stone-700">${ord.name}<div class="text-[10px] text-brand-text-muted mt-0.5">${ord.phone}</div></td>
                        <td class="p-3 font-semibold text-stone-700">${ord.product}</td>
                        <td class="p-3">${specsDetail}</td>
                        <td class="p-3 text-red-700 font-medium max-w-xs truncate" title="${ord.returnReason || ''}">${ord.returnReason || '-'}</td>
                        <td class="p-3 text-center">
                            <input type="checkbox" ${ord.refundIssued ? 'checked' : ''} onchange="toggleRefundIssued('${ord.id}', this.checked)" class="rounded text-brand-accent border-[#DCD5CB] focus:ring-brand-accent cursor-pointer w-4 h-4">
                        </td>
                        <td class="p-3 text-center">${proofHtml}</td>
                        <td class="p-3 text-center">
                            <button onclick="removeReturnedLogRecord('${ord.id}')" class="text-red-400 hover:text-red-700 transition" title="Delete Log permanently">
                                <i class="fas fa-trash-alt text-xs"></i>
                            </button>
                        </td>
                    `;
                    if (returnedTbody) returnedTbody.appendChild(tr);
                });
            }
        }

        // Star Rating feedback selectors UI controller
        function setStarRating(val) {
            document.getElementById('feedbackRatingValue').value = val;
            const stars = document.querySelectorAll('.star-btn');
            stars.forEach(star => {
                const starVal = parseInt(star.getAttribute('data-val'));
                if (starVal <= val) {
                    star.className = "fas fa-star cursor-pointer star-btn";
                } else {
                    star.className = "far fa-star cursor-pointer star-btn";
                }
            });
        }

        // Open feedback modal panel
        function openFeedbackModal(orderId) {
            const ord = UNSEEN_ORDERS.find(o => String(o.id) === String(orderId));
            if (!ord) return;

            document.getElementById('feedbackOrderId').value = orderId;
            tempFeedbackImage = "";

            if (ord.feedback) {
                // Populate existing feedback parameters
                setStarRating(ord.feedback.rating);
                document.getElementById('feedbackMessage').value = ord.feedback.message;
                if (ord.feedback.image) {
                    tempFeedbackImage = ord.feedback.image;
                    document.getElementById('feedbackImagePreview').src = ord.feedback.image;
                    document.getElementById('feedbackImagePreviewContainer').classList.remove('hidden');
                } else {
                    document.getElementById('feedbackImagePreviewContainer').classList.add('hidden');
                }
            } else {
                setStarRating(0);
                document.getElementById('feedbackMessage').value = "";
                document.getElementById('feedbackImagePreviewContainer').classList.add('hidden');
            }

            document.getElementById('feedbackImageInput').value = "";
            document.getElementById('feedbackModal').classList.remove('hidden');
        }

        function closeFeedbackModal() {
            document.getElementById('feedbackModal').classList.add('hidden');
        }

        // Submit client feedback & dynamic rating scores calculations
        function handleFeedbackSubmit(event) {
            event.preventDefault();

            const orderId = document.getElementById('feedbackOrderId').value;
            const rating = parseInt(document.getElementById('feedbackRatingValue').value);
            const message = document.getElementById('feedbackMessage').value.trim();

            if (rating === 0) {
                triggerToast("Please choose a star rating score first.");
                return;
            }

            const ord = UNSEEN_ORDERS.find(o => String(o.id) === String(orderId));
            if (ord) {
                ord.feedback = {
                    rating: rating,
                    message: message,
                    image: tempFeedbackImage
                };

                saveOrderToFirebase(ord);
                closeFeedbackModal();
                triggerToast("Customer feedback and rating aggregated successfully!");
            }
        }

        // Toggle verification check on refunds issued
        function toggleRefundIssued(id, checkedVal) {
            const ord = UNSEEN_ORDERS.find(o => String(o.id) === String(id));
            if (ord) {
                ord.refundIssued = checkedVal;
                saveOrderToFirebase(ord);
                triggerToast(checkedVal ? "Refund status updated to Issued." : "Refund status updated to Pending.");
            }
        }

        // Processing photo upload proofs (instapay or Whatsapp screen captures)
        function handleImageUpload(event, orderId) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.src = e.target.result;
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const max_width = 320;
                    const scaleSize = max_width / img.width;
                    canvas.width = max_width;
                    canvas.height = img.height * scaleSize;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
                    
                    // Save in matching returned order
                    const ord = UNSEEN_ORDERS.find(o => String(o.id) === String(orderId));
                    if (ord) {
                        ord.refundProof = compressedBase64;
                        saveOrderToFirebase(ord);
                        triggerToast("Refund screenshot documentation uploaded successfully!");
                    }
                }
            };
            reader.readAsDataURL(file);
        }

        // Delete screenshot
        function deleteRefundProof(id) {
            const ord = UNSEEN_ORDERS.find(o => String(o.id) === String(id));
            if (ord) {
                delete ord.refundProof;
                saveOrderToFirebase(ord);
                triggerToast("Refund documentation deleted.");
            }
        }

        // Expand screenshot in lightbox view
        function viewProofModal(imageSrc) {
            const modal = document.getElementById('proofModal');
            const img = document.getElementById('proofModalImage');
            img.src = imageSrc;
            modal.classList.remove('hidden');
        }

        function closeProofModal() {
            document.getElementById('proofModal').classList.add('hidden');
        }

        // Mark active order as delivered
        function markOrderAsDelivered(id) {
            const ord = UNSEEN_ORDERS.find(o => String(o.id) === String(id));
            if (ord) {
                ord.status = 'delivered';
                ord.deliveredDate = new Date().toISOString().split('T')[0];
                saveOrderToFirebase(ord);
                triggerToast("Order marked as Delivered successfully! Revenue & Profits accounted for.");
            }
        }

        // Cancel Active Orders: removes from queue and adds inventory back
        function cancelOrderRecord(id) {
            const transaction = UNSEEN_ORDERS.find(ord => String(ord.id) === String(id));
            if (transaction) {
                const associatedProduct = UNSEEN_PRODUCTS.find(p => p.name === transaction.product);
                if (associatedProduct) {
                    restoreVariantStock(
                        associatedProduct,
                        transaction.color,
                        transaction.size,
                        transaction.material,
                        1
                    );
                    saveProductToFirebase(associatedProduct).then(() => refreshInventoryUI());
                }
                
                deleteOrderFromFirebase(id);
                triggerToast("Order cancelled and item returned to stock inventory.");
            }
        }

        // Permanently clear a returned log row
        function removeReturnedLogRecord(id) {
            deleteOrderFromFirebase(id);
            triggerToast("Returned order log cleared permanently.");
        }

        // Open Log Product Return Reason Capture Popup
        function openReturnModal(orderId) {
            document.getElementById('returnOrderId').value = orderId;
            document.getElementById('returnReasonText').value = '';
            document.getElementById('returnModal').classList.remove('hidden');
        }

        function closeReturnModal() {
            document.getElementById('returnModal').classList.add('hidden');
        }

        // Submit and log return process
        function submitReturnOrder() {
            const orderId = document.getElementById('returnOrderId').value;
            const reason = document.getElementById('returnReasonText').value.trim();

            if (!reason) {
                triggerToast("Please provide a return reason.");
                return;
            }

            const ord = UNSEEN_ORDERS.find(o => String(o.id) === String(orderId));
            if (ord) {
                ord.status = 'returned';
                ord.returnReason = reason;
                ord.returnDate = new Date().toISOString().split('T')[0];
                ord.refundIssued = false; // defaults to pending refund

                // Increment stock inventory back for associated variant
                const productObj = UNSEEN_PRODUCTS.find(p => p.name === ord.product);
                if (productObj) {
                    restoreVariantStock(productObj, ord.color, ord.size, ord.material, 1);
                    saveProductToFirebase(productObj).then(() => refreshInventoryUI());
                }

                saveOrderToFirebase(ord);
                closeReturnModal();
                triggerToast("Order processed as Returned. Stock added back, and financials adjusted.");
            }
        }

        // Open logging sale order popup dialog
        function openOrderModal() {
            const selectEl = document.getElementById('itemProductSelect');
            selectEl.innerHTML = '';

            UNSEEN_PRODUCTS.forEach(p => syncProductAggregateStock(p));
            const stockAvailableProducts = UNSEEN_PRODUCTS.filter(p => p.stock > 0);

            if (stockAvailableProducts.length === 0) {
                triggerToast("Cannot record sale. All designed products in stock are currently empty!");
                return;
            }

            stockAvailableProducts.forEach(prod => {
                const opt = document.createElement('option');
                opt.value = prod.name;
                opt.innerText = `${prod.name} (${prod.stock} total in stock)`;
                selectEl.appendChild(opt);
            });

            // Auto fill current date
            document.getElementById('custOrderDate').value = new Date().toISOString().split('T')[0];

            document.getElementById('orderModal').classList.remove('hidden');
            adaptOrderFormOptions();
        }

        function closeOrderModal() {
            document.getElementById('orderModal').classList.add('hidden');
        }

        function appendOrderSelectOption(selectEl, value, label, inStock, selected = false) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            opt.disabled = !inStock;
            if (!inStock) {
                opt.className = 'text-gray-400 bg-gray-50';
            }
            if (selected && inStock) opt.selected = true;
            selectEl.appendChild(opt);
        }

        function rebuildOrderColorDropdown(product, preserveColor = null) {
            const colorDropdown = document.getElementById('orderProductColor');
            if (!colorDropdown) return;

            const items = getProductItems(product);
            const colorList = [...new Set(items.map(i => i.color).filter(Boolean))];
            const fallbackColors = product.colors || [];
            const colors = colorList.length ? colorList : fallbackColors;

            const prevColor = preserveColor || colorDropdown.value;
            colorDropdown.innerHTML = '';

            colors.forEach(col => {
                const variantsForColor = items.filter(i => i.color === col);
                const totalQty = variantsForColor.reduce((s, i) => s + (parseInt(i.quantity, 10) || 0), 0);
                const inStock = totalQty > 0;
                const label = inStock ? `${col} (${totalQty} available)` : `${col} — Out of Stock`;
                const shouldSelect = prevColor === col && inStock;
                appendOrderSelectOption(colorDropdown, col, label, inStock, shouldSelect);
            });

            const firstInStock = Array.from(colorDropdown.options).find(o => !o.disabled);
            if (firstInStock && !Array.from(colorDropdown.options).some(o => o.selected && !o.disabled)) {
                firstInStock.selected = true;
            }
        }

        function rebuildOrderSizeDropdown(product) {
            const sizeDropdown = document.getElementById('orderProductSize');
            const color = document.getElementById('orderProductColor')?.value;
            if (!sizeDropdown || !color) return;

            const items = getProductItems(product);
            const sizesForColor = [...new Set(items.filter(i => i.color === color).map(i => i.size).filter(Boolean))];
            const prevSize = sizeDropdown.value;

            sizeDropdown.innerHTML = '';

            sizesForColor.forEach(sz => {
                const variant = findProductVariant(product, color, sz);
                const qty = variant ? (parseInt(variant.quantity, 10) || 0) : 0;
                const inStock = qty > 0;
                const label = inStock ? `${sz} (${qty} available)` : `${sz} — Out of Stock`;
                const shouldSelect = prevSize === sz && inStock;
                appendOrderSelectOption(sizeDropdown, sz, label, inStock, shouldSelect);
            });

            const firstInStock = Array.from(sizeDropdown.options).find(o => !o.disabled);
            if (firstInStock && !Array.from(sizeDropdown.options).some(o => o.selected && !o.disabled)) {
                firstInStock.selected = true;
            }
        }

        function updateOrderStockHint() {
            const hint = document.getElementById('order-stock-hint');
            const submitBtn = document.getElementById('orderSubmitBtn');
            const product = getSelectedOrderProduct();
            if (!hint) return;

            if (!product) {
                hint.classList.add('hidden');
                return;
            }

            const color = document.getElementById('orderProductColor')?.value;
            const size = document.getElementById('orderProductSize')?.value;
            const material = resolveItemMaterial(product, color, size);
            const qty = getVariantQuantity(product, color, size, material);
            const variant = findProductVariant(product, color, size, material);

            hint.classList.remove('hidden');

            if (!color || !size) {
                hint.className = 'text-xs font-medium text-brand-text-muted bg-[#FAF8F5] border border-[#EBE6DD] rounded-xl px-3 py-2';
                hint.innerText = 'Select color and size to view variant availability.';
                if (submitBtn) submitBtn.disabled = true;
                return;
            }

            if (!variant || qty <= 0) {
                hint.className = 'text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2';
                hint.innerText = 'Out of stock — this variant cannot be ordered.';
                if (submitBtn) submitBtn.disabled = true;
                return;
            }

            hint.className = 'text-xs font-semibold text-green-800 bg-green-50 border border-green-200 rounded-xl px-3 py-2';
            hint.innerText = `${qty} unit(s) available · ${material} · ${color} · ${size}`;
            if (submitBtn) submitBtn.disabled = false;
        }

        function onOrderColorChange() {
            const product = getSelectedOrderProduct();
            if (product) rebuildOrderSizeDropdown(product);
            onOrderVariantChange();
        }

        function onOrderVariantChange() {
            updateOrderPricePreview();
            updateOrderStockHint();
        }

        function updateOrderPricePreview() {
            const targetModel = getSelectedOrderProduct();
            if (!targetModel) return;

            const color = document.getElementById('orderProductColor')?.value;
            const size = document.getElementById('orderProductSize')?.value;
            const material = resolveItemMaterial(targetModel, color, size);
            document.getElementById('orderProductMaterial').value = material;

            const cost = resolveItemCost(targetModel, color, size, material);
            const markupVal = cost + (cost * (UNSEEN_MARGIN / 100));
            document.getElementById('priceVal').innerText = `EGP ${markupVal.toLocaleString()}`;
        }

        // Read active model design options and show them dynamically in order form
        function adaptOrderFormOptions() {
            const targetModel = getSelectedOrderProduct();

            if (!targetModel) return;

            rebuildOrderColorDropdown(targetModel);
            rebuildOrderSizeDropdown(targetModel);

            const customOrderContainer = document.getElementById('dynamic-order-fields');
            customOrderContainer.innerHTML = '';

            if (targetModel.customAttributes && Object.keys(targetModel.customAttributes).length > 0) {
                for (const [key, values] of Object.entries(targetModel.customAttributes)) {
                    if (values && values.length > 0) {
                        const wrapper = document.createElement('div');
                        wrapper.className = "flex flex-col";
                        
                        let optionElements = values.map(v => `<option value="${v}">${v}</option>`).join('');

                        wrapper.innerHTML = `
                            <label class="block text-[10px] font-bold text-brand-text-muted uppercase tracking-wider mb-1">${key} *</label>
                            <select name="custom-order-attr" data-attr-name="${key}" required class="w-full p-2.5 border border-[#DCD5CB] rounded-xl text-xs bg-brand-bg focus:outline-none focus:ring-1 focus:ring-brand-accent">
                                ${optionElements}
                            </select>
                        `;
                        customOrderContainer.appendChild(wrapper);
                    }
                }
            }

            onOrderVariantChange();
        }

        // Form Order submit execution with connectivity guards
        async function handleOrderSubmit(event) {
            event.preventDefault();

            // Strict Network connectivity check to prompt error states if offline
            if (!navigator.onLine) {
                triggerToast("Order creation failed. Slow connectivity or network failure. Please try again.");
                return;
            }

            const cName = document.getElementById('custName').value.trim();
            const cPhone = document.getElementById('custPhone').value.trim();
            const cDate = document.getElementById('custOrderDate').value;
            const pModelName = document.getElementById('itemProductSelect').value;
            const pColorSelected = document.getElementById('orderProductColor').value;
            const pSizeSelected = document.getElementById('orderProductSize').value;
            const cAddress = document.getElementById('custAddress').value.trim();

            const matchedProduct = UNSEEN_PRODUCTS.find(p => p.name === pModelName);
            if (!matchedProduct) {
                triggerToast("Product not found.");
                return;
            }

            syncProductAggregateStock(matchedProduct);

            const orderMaterial = resolveItemMaterial(matchedProduct, pColorSelected, pSizeSelected);
            const orderQty = 1;

            if (!isVariantInStock(matchedProduct, pColorSelected, pSizeSelected, orderMaterial, orderQty)) {
                triggerToast("Insufficient stock for this item.");
                updateOrderStockHint();
                return;
            }

            let customSelections = {};
            const selectElList = document.querySelectorAll('select[name="custom-order-attr"]');
            selectElList.forEach(selectEl => {
                const attrName = selectEl.getAttribute('data-attr-name');
                customSelections[attrName] = selectEl.value;
            });

            const itemCost = resolveItemCost(matchedProduct, pColorSelected, pSizeSelected, orderMaterial);
            const calculatedSellingPrice = itemCost + (itemCost * (UNSEEN_MARGIN / 100));

            const stockResult = deductVariantStock(matchedProduct, pColorSelected, pSizeSelected, orderMaterial, orderQty);
            if (!stockResult.ok) {
                triggerToast(stockResult.message || "Insufficient stock for this item.");
                return;
            }

            const newOrder = {
                id: String(Date.now()),
                name: cName,
                phone: cPhone,
                date: cDate,
                product: pModelName,
                material: orderMaterial,
                color: pColorSelected,
                size: pSizeSelected,
                cost: itemCost,
                price: calculatedSellingPrice,
                address: cAddress,
                status: 'active',
                customSelections: customSelections,
                createdAt: Date.now()
            };

            const productIdx = UNSEEN_PRODUCTS.findIndex(p => p.id === matchedProduct.id);
            if (productIdx !== -1) UNSEEN_PRODUCTS[productIdx] = matchedProduct;

            await saveProductToFirebase(matchedProduct);
            await saveOrderToFirebase(newOrder);

            refreshInventoryUI();
            closeOrderModal();
            triggerToast("Order added successfully! Inventory updated.");
        }

        // Visualize analytical data (Charts reflect orders matched by Filter)
        function renderAnalyticalCharts() {
            const pPl = document.getElementById('piecesChartPlaceholder');
            const fPl = document.getElementById('fabricsChartPlaceholder');
            const sPl = document.getElementById('sizesChartPlaceholder');

            // Apply active Time Horizon filter directly to analytical charts
            const targetOrders = getFilteredOrders();
            const deliveredOrders = targetOrders.filter(o => o.status === 'delivered');

            if (deliveredOrders.length === 0) {
                if (pPl) pPl.classList.remove('hidden');
                if (fPl) fPl.classList.remove('hidden');
                if (sPl) sPl.classList.remove('hidden');
                
                if (piecesChart) piecesChart.destroy();
                if (fabricsChart) fabricsChart.destroy();
                if (sizesChart) sizesChart.destroy();
                return;
            } else {
                if (pPl) pPl.classList.add('hidden');
                if (fPl) fPl.classList.add('hidden');
                if (sPl) sPl.classList.add('hidden');
            }

            let productsSalesCounter = {};
            UNSEEN_PRODUCTS.forEach(p => productsSalesCounter[p.name] = 0);

            let materialsSalesCounter = {};
            UNSEEN_MATERIALS.forEach(m => materialsSalesCounter[m] = 0);

            let sizesSalesCounter = {};
            UNSEEN_SIZES.forEach(sz => sizesSalesCounter[sz] = 0);

            deliveredOrders.forEach(ord => {
                if (productsSalesCounter[ord.product] !== undefined) {
                    productsSalesCounter[ord.product]++;
                } else {
                    productsSalesCounter[ord.product] = 1;
                }

                if (materialsSalesCounter[ord.material] !== undefined) {
                    materialsSalesCounter[ord.material]++;
                } else {
                    materialsSalesCounter[ord.material] = 1;
                }

                if (sizesSalesCounter[ord.size] !== undefined) {
                    sizesSalesCounter[ord.size]++;
                } else {
                    sizesSalesCounter[ord.size] = 1;
                }
            });

            const stylePalette = ['#302924', '#A39282', '#72675F', '#DCD5CB', '#5F544A', '#FAF8F5'];

            const canvasPiecesEl = document.getElementById('piecesChart');
            if (canvasPiecesEl) {
                const canvasPieces = canvasPiecesEl.getContext('2d');
                if (piecesChart) piecesChart.destroy();
                piecesChart = new Chart(canvasPieces, {
                    type: 'bar',
                    data: {
                        labels: Object.keys(productsSalesCounter),
                        datasets: [{
                            label: 'Recorded Orders Count',
                            data: Object.values(productsSalesCounter),
                            backgroundColor: stylePalette.slice(0, Math.max(1, Object.keys(productsSalesCounter).length)),
                            borderRadius: 8
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            y: { beginAtZero: true, grid: { color: '#EBE6DD' }, ticks: { stepSize: 1, font: { family: 'Inter' } } },
                            x: { grid: { display: false }, ticks: { font: { family: 'Inter' } } }
                        }
                    }
                });
            }

            const canvasFabricsEl = document.getElementById('fabricsChart');
            if (canvasFabricsEl) {
                const canvasFabrics = canvasFabricsEl.getContext('2d');
                if (fabricsChart) fabricsChart.destroy();
                fabricsChart = new Chart(canvasFabrics, {
                    type: 'pie',
                    data: {
                        labels: Object.keys(materialsSalesCounter),
                        datasets: [{
                            data: Object.values(materialsSalesCounter),
                            backgroundColor: stylePalette,
                            borderWidth: 2,
                            borderColor: '#FFFFFF'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 11 } } }
                        }
                    }
                });
            }

            const canvasSizesEl = document.getElementById('sizesChart');
            if (canvasSizesEl) {
                const canvasSizes = canvasSizesEl.getContext('2d');
                if (sizesChart) sizesChart.destroy();
                sizesChart = new Chart(canvasSizes, {
                    type: 'doughnut',
                    data: {
                        labels: Object.keys(sizesSalesCounter),
                        datasets: [{
                            data: Object.values(sizesSalesCounter),
                            backgroundColor: stylePalette,
                            borderWidth: 2,
                            borderColor: '#FFFFFF'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '72%',
                        plugins: {
                            legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 11 } } }
                        }
                    }
                });
            }
        }

        // Custom Safe Deletion / System Prompt Dialog handlers
        function openConfirmModal(action) {
            activeConfirmAction = action;
            const modal = document.getElementById('confirmModal');
            const title = document.getElementById('confirmTitle');
            const msg = document.getElementById('confirmMessage');

            if (action === 'reset') {
                title.innerText = "Confirm Factory Reset";
                msg.innerText = "Are you sure you want to restore the system to empty defaults? This will wipe designed models, raw attributes, custom metrics, and orders from both cloud and offline storages.";
            }

            modal.classList.remove('hidden');
        }

        // Close safe dialog modal
        function closeConfirmModal() {
            document.getElementById('confirmModal').classList.add('hidden');
            activeConfirmAction = null;
        }

        // Action confirmation trigger
        document.getElementById('confirmBtnAction').onclick = async function() {
            if (activeConfirmAction === 'reset') {
                // Reset local fallback
                localStorage.removeItem('unseen_materials_v2');
                localStorage.removeItem('unseen_colors_v2');
                localStorage.removeItem('unseen_sizes_v2');
                localStorage.removeItem('unseen_products_v2');
                localStorage.removeItem('unseen_orders_v2');
                localStorage.removeItem('unseen_custom_attrs_v2');
                localStorage.removeItem('unseen_capacity_v2');
                localStorage.removeItem('unseen_margin_v2');
                localStorage.removeItem('unseen_master_user');
                localStorage.removeItem('unseen_master_pass');
                sessionStorage.removeItem('unseen_session_active');

                // Clear remote Firestore database docs safely
                if (isFirebaseActive) {
                    try {
                        // Delete products collection
                        const prodSnap = await window.F_API.getDocs(window.F_API.collection(db, 'artifacts', appId, 'public', 'data', 'products'));
                        prodSnap.forEach(async (doc) => {
                            await window.F_API.deleteDoc(doc.ref);
                        });

                        // Delete orders collection
                        const ordSnap = await window.F_API.getDocs(window.F_API.collection(db, 'artifacts', appId, 'public', 'data', 'orders'));
                        ordSnap.forEach(async (doc) => {
                            await window.F_API.deleteDoc(doc.ref);
                        });

                        // Clear config
                        const configDocPath = window.F_API.doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'config');
                        await window.F_API.deleteDoc(configDocPath);

                    } catch (e) {
                        console.error("Error executing complete DB reset:", e);
                    }
                }

                UNSEEN_MATERIALS = [...defaultMaterials];
                UNSEEN_COLORS = [...defaultColors];
                UNSEEN_SIZES = [...defaultSizes];
                UNSEEN_PRODUCTS = [];
                UNSEEN_ORDERS = [];
                UNSEEN_CUSTOM_ATTRIBUTES = [];
                UNSEEN_CAPACITY = 18;
                UNSEEN_MARGIN = 50;

                closeConfirmModal();
                location.reload();
            }
        };

        // Custom dynamic Toast notification system
        function triggerToast(message) {
            const toast = document.getElementById('toast');
            document.getElementById('toast-text').innerText = message;
            toast.classList.remove('hidden');
            setTimeout(() => {
                toast.classList.add('hidden');
            }, 3500);
        }