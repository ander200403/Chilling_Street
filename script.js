// Configuración y Estado
const URL_CSV_PROD = "https://docs.google.com/spreadsheets/d/1l0uryei0Z3M5b28ECbDTI8X1UbyH5l2JvZaGlUg7mGM/export?format=csv&gid=0";
const URL_CSV_VAR = "https://docs.google.com/spreadsheets/d/1l0uryei0Z3M5b28ECbDTI8X1UbyH5l2JvZaGlUg7mGM/export?format=csv&gid=129169326";
const WHATSAPP = "584242193836";

let products = [];
let variantsByProduct = {}; 

let currentModalProduct = null;
let selectedColorData = null;
let selectedSize = null;

let cart = (function() {
  try { return JSON.parse(localStorage.getItem('cs_cart')) || []; }
  catch(e) { return []; }
})();

// Utilidades: Enlaces estables y sin bloqueos
function getStableImageUrl(rawImg) {
  if (!rawImg) return '';
  if (rawImg.indexOf('drive.google.com') !== -1) {
    const matchD = rawImg.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const matchId = rawImg.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const driveId = (matchD && matchD[1]) || (matchId && matchId[1]);
    if (driveId) return 'https://lh3.googleusercontent.com/d/' + driveId;
  }
  return rawImg;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if(!toast) return;
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Carga Dual de Datos ──
async function loadData() {
  try {
    const tstamp = new Date().getTime();
    const [resProd, resVar] = await Promise.all([
      fetch(URL_CSV_PROD + "&t=" + tstamp),
      fetch(URL_CSV_VAR + "&t=" + tstamp)
    ]);
    
    const rawProd = await resProd.text();
    const rawVar = await resVar.text();

    Papa.parse(rawVar, {
      header: false,
      skipEmptyLines: true,
      complete: function(results) {
        const rows = results.data.slice(1);
        rows.forEach(row => {
          const idVar = row[0] ? row[0].trim() : '';
          const idProdPadre = row[1] ? row[1].trim() : '';
          const colorName = row[2] ? row[2].trim() : '';
          const tallasStr = row[3] ? row[3].trim() : '';
          const imgColorRaw = row[4] ? row[4].trim() : '';
          const imgBackRaw = row[5] ? row[5].trim() : '';
          
          if (!idProdPadre) return;
          if (!variantsByProduct[idProdPadre]) variantsByProduct[idProdPadre] = [];
          
          variantsByProduct[idProdPadre].push({
            idVar: idVar,
            color: colorName,
            tallas: tallasStr ? tallasStr.split(',').map(t => t.trim().toUpperCase()) : [],
            imgColor: getStableImageUrl(imgColorRaw),
            imgBack: getStableImageUrl(imgBackRaw)
          });
        });
      }
    });

    Papa.parse(rawProd, {
      header: false,
      skipEmptyLines: true,
      complete: function(results) {
        const rows = results.data.slice(1);
        products = rows.map((cols, index) => {
          const idProd = cols[0] ? cols[0].trim() : String(index);
          const rawPrice = cols[4] ? String(cols[4]).replace(/[^0-9.-]+/g, '') : '0';
          const parsedPrice = parseFloat(rawPrice) || 0;
          const rawDiscount = cols[11] ? cols[11].trim() : '';
          const discountMatch = rawDiscount.match(/\d+/);
          const discountPercent = discountMatch ? parseInt(discountMatch[0], 10) : 0;
          let originalPrice = null;
          
          if (discountPercent > 0 && discountPercent < 100 && parsedPrice > 0) {
            originalPrice = parsedPrice / (1 - (discountPercent / 100));
          }

          const rawStock = cols[8] ? cols[8].trim().toLowerCase() : '';
          const inStock = rawStock !== 'agotado' && rawStock !== 'no' && rawStock !== '0';
          
          const rawCarousel = cols[10] ? cols[10].trim() : '';
          const carouselMatch = rawCarousel.match(/\d+/);

          return {
            id: idProd,
            title: cols[1] || 'Sin título',
            brand: cols[2] || '',
            category: cols[3] || '',
            price: parsedPrice,
            desc: cols[5] || '',
            globalSizes: cols[6] ? cols[6].split(',').map(t => t.trim().toUpperCase()) : [],
            img: getStableImageUrl(cols[7] ? cols[7].trim() : ''),
            inStock: inStock,
            badge: cols[9] ? cols[9].trim() : '',
            carouselRank: carouselMatch ? parseInt(carouselMatch[0], 10) : null,
            discountPercent: discountPercent,
            originalPrice: originalPrice,
            imgBack: getStableImageUrl(cols[12] ? cols[12].trim() : ''),
            variants: variantsByProduct[idProd] || [] 
          };
        }).filter(p => p.title !== 'Sin título');

        populateFilters();
        renderCarousel();
        renderGrid(products);
        updateCartUI();
      }
    });
  } catch(e) {
    console.error("Error cargando inventario:", e);
  }
}

function populateFilters() {
  const seen = {};
  const select = document.getElementById('genreFilter');
  if(!select) return;
  select.innerHTML = '<option value="">Todas las categorías</option>';
  
  products.forEach(p => {
    const cat = p.category.trim();
    if(cat && !seen[cat]) {
      seen[cat] = true;
      const opt = document.createElement('option');
      opt.value = cat; opt.textContent = cat;
      select.appendChild(opt);
    }
  });
}

function applyFilters() {
  const term = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const cat = document.getElementById('genreFilter')?.value || '';
  const sort = document.getElementById('sortSelect')?.value || '';

  let filtered = products.filter(p => {
    const matchText = !term || p.title.toLowerCase().includes(term) || p.brand.toLowerCase().includes(term);
    const matchCat = !cat || p.category === cat;
    return matchText && matchCat;
  });

  if (sort === 'price-asc') filtered.sort((a,b) => a.price - b.price);
  if (sort === 'price-desc') filtered.sort((a,b) => b.price - a.price);

  renderGrid(filtered);
}

// ── Render Principal ──
function renderGrid(lista) {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  grid.style.display = 'grid';
  const skeleton = document.getElementById('skeletonGrid');
  if (skeleton) skeleton.style.display = 'none';

  if (lista.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);">No items found.</div>';
    return;
  }
  
  grid.innerHTML = lista.map(p => {
    const outClass = p.inStock ? '' : ' out-of-stock';
    const badgeHtml = !p.inStock ? '<span class="badge-agotado">SOLD OUT</span>' : 
                     (p.badge ? `<span class="special-badge">${p.badge}</span>` : '');
    
    let priceHtml = p.originalPrice 
      ? `<div class="price-wrap"><span class="price-original">$${p.originalPrice.toFixed(2)}</span><span class="card-price">$${p.price.toFixed(2)}</span></div>`
      : `<div class="price-wrap"><span class="card-price">$${p.price.toFixed(2)}</span></div>`;

    return `
      <div class="card${outClass}" onclick="openModal('${p.id}')">
        <div class="card-wrap">
          ${badgeHtml}
          <img data-src="${p.img}" class="card-img" onerror="this.src='https://placehold.co/400x500/111/333?text=CS'">
        </div>
        <div class="card-body">
          <div class="card-brand">${p.brand}</div>
          <div class="card-title">${p.title}</div>
          ${priceHtml}
          <button class="btn-view">VER OPCIONES</button>
        </div>
      </div>
    `;
  }).join('');

  const imgs = document.querySelectorAll('.card-img[data-src]');
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if(e.isIntersecting) {
        e.target.src = e.target.dataset.src;
        e.target.onload = () => e.target.classList.add('loaded');
        obs.unobserve(e.target);
      }
    });
  });
  imgs.forEach(i => obs.observe(i));
  
  const countBox = document.getElementById('resultsCount');
  if(countBox) countBox.innerText = `${lista.length} ITEMS`;
}

function renderCarousel() {
  const sec = document.getElementById('topCarouselSection');
  const track = document.getElementById('carouselTrack');
  if (!sec || !track) return;

  const top = products.filter(p => p.carouselRank !== null).sort((a,b) => a.carouselRank - b.carouselRank);
  if (top.length === 0) return;

  sec.style.display = 'block';
  track.innerHTML = top.map(p => `
    <div class="carousel-item" onclick="openModal('${p.id}')">
      <img class="carousel-img" src="${p.img}" onerror="this.src='https://placehold.co/400x500/111/333?text=CS'">
      <div class="carousel-number">${p.carouselRank}</div>
    </div>
  `).join('');
}

// ── Toggle Frente / Dorsal ──
let _showingBack = false;

function _updateFlipToggle(frontSrc, backSrc) {
  _showingBack = false;
  const toggleBtn = document.getElementById('btnFlipView');
  const modalImg = document.getElementById('modalImg');
  if (!toggleBtn) return;

  modalImg.src = frontSrc;

  if (backSrc) {
    toggleBtn.style.display = 'flex';
    toggleBtn.setAttribute('data-front', frontSrc);
    toggleBtn.setAttribute('data-back', backSrc);
    toggleBtn.innerHTML = '↺ VER DORSAL';
    toggleBtn.classList.remove('flipped');
  } else {
    toggleBtn.style.display = 'none';
  }
}

function toggleFlipView() {
  const toggleBtn = document.getElementById('btnFlipView');
  const modalImg = document.getElementById('modalImg');
  if (!toggleBtn) return;

  const frontSrc = toggleBtn.getAttribute('data-front');
  const backSrc = toggleBtn.getAttribute('data-back');

  _showingBack = !_showingBack;

  modalImg.style.opacity = '0';
  modalImg.style.transition = 'opacity 0.25s ease';
  setTimeout(() => {
    modalImg.src = _showingBack ? backSrc : frontSrc;
    modalImg.style.opacity = '1';
  }, 200);

  toggleBtn.innerHTML = _showingBack ? '↺ VER FRENTE' : '↺ VER DORSAL';
  toggleBtn.classList.toggle('flipped', _showingBack);
}

// ── Lógica de Variantes en Modal ──
function openModal(idStr) {
  const p = products.find(x => String(x.id) === String(idStr));
  if(!p) return;
  
  currentModalProduct = p;
  selectedColorData = null;
  selectedSize = null;

  document.getElementById('modalImg').src = p.img;
  document.getElementById('modalTitle').innerText = p.title;
  document.getElementById('modalAuthor').innerText = p.brand;
  document.getElementById('modalDesc').innerText = p.desc;

  // Reset flip toggle
  _updateFlipToggle(p.img, p.imgBack || '');
  
  const mpEl = document.getElementById('modalPrice');
  if (p.originalPrice) {
    mpEl.innerHTML = `<span class="price-original" style="font-size:1rem;">$${p.originalPrice.toFixed(2)}</span> $${p.price.toFixed(2)} <span class="discount-tag" style="font-size:0.75rem;">-${p.discountPercent}%</span>`;
  } else {
    mpEl.innerText = `$${p.price.toFixed(2)}`;
  }

  const cGroup = document.getElementById('colorGroup');
  const sGroup = document.getElementById('sizeGroup');
  const cOpts = document.getElementById('colorOptions');
  const sOpts = document.getElementById('sizeOptions');
  const btnAdd = document.getElementById('btnAddToCart');

  document.getElementById('selectedSizeName').innerText = "Selecciona una";
  btnAdd.innerText = "SELECCIONA TALLA";
  btnAdd.disabled = true;

  if (p.variants && p.variants.length > 0) {
    cGroup.style.display = 'block';
    
    cOpts.innerHTML = p.variants.map((v, i) => {
      const hex = v.color.toLowerCase() === 'negro' ? '#111' : (v.color.toLowerCase() === 'blanco' ? '#fff' : '#666');
      return `<button class="color-btn" style="background-color:${hex}; border: 2px solid rgba(255,255,255,0.3);" title="${v.color}" onclick="selectColor(${i})"></button>`;
    }).join('');
    
    selectColor(0);
  } else {
    cGroup.style.display = 'none';
    if(p.globalSizes && p.globalSizes.length > 0) {
      sGroup.style.display = 'block';
      renderSizes(p.globalSizes);
    } else {
      sGroup.style.display = 'none';
      selectedSize = 'Única';
      btnAdd.innerText = "AÑADIR AL CARRITO";
      btnAdd.disabled = !p.inStock;
    }
  }

  document.getElementById('modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function selectColor(index) {
  const variants = currentModalProduct.variants;
  if(!variants || !variants[index]) return;
  
  selectedColorData = variants[index];
  selectedSize = null;
  
  document.getElementById('selectedColorName').innerText = selectedColorData.color;
  const btns = document.getElementById('colorOptions').querySelectorAll('.color-btn');
  btns.forEach((b, i) => b.classList.toggle('active', i === index));
  
  if(selectedColorData.imgColor) {
    document.getElementById('modalImg').src = selectedColorData.imgColor;
  } else {
    document.getElementById('modalImg').src = currentModalProduct.img;
  }

  // Update flip toggle with variant-specific back image (or product-level fallback)
  const frontImg = selectedColorData.imgColor || currentModalProduct.img;
  const backImg = selectedColorData.imgBack || currentModalProduct.imgBack || '';
  _updateFlipToggle(frontImg, backImg);

  document.getElementById('sizeGroup').style.display = 'block';
  renderSizes(selectedColorData.tallas);
  
  const btnAdd = document.getElementById('btnAddToCart');
  document.getElementById('selectedSizeName').innerText = "Selecciona una";
  btnAdd.innerText = "SELECCIONA TALLA";
  btnAdd.disabled = true;
}

function renderSizes(tallasArray) {
  const sOpts = document.getElementById('sizeOptions');
  if(!tallasArray || tallasArray.length === 0) {
    sOpts.innerHTML = '<span style="font-size:0.8rem; color:var(--error);">Agotado en este color</span>';
    return;
  }
  
  sOpts.innerHTML = tallasArray.map(t => 
    `<button class="size-btn" onclick="selectSize('${t}')">${t}</button>`
  ).join('');
}

function selectSize(talla) {
  selectedSize = talla;
  document.getElementById('selectedSizeName').innerText = talla;
  
  const btns = document.getElementById('sizeOptions').querySelectorAll('.size-btn');
  btns.forEach(b => b.classList.toggle('active', b.innerText === talla));
  
  const btnAdd = document.getElementById('btnAddToCart');
  btnAdd.innerText = "AÑADIR AL CARRITO";
  btnAdd.disabled = !currentModalProduct.inStock;
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  document.body.style.overflow = 'auto';
}

// ── Carrito de Compras ──
function addToCartFromModal() {
  if (!currentModalProduct) return;
  if (!selectedSize && document.getElementById('sizeGroup').style.display !== 'none') {
    showToast("⚠️ Selecciona una talla primero");
    return;
  }

  const colorStr = selectedColorData ? selectedColorData.color : '';
  const sizeStr = selectedSize || 'Única';
  const imgToSave = (selectedColorData && selectedColorData.imgColor) ? selectedColorData.imgColor : currentModalProduct.img;
  
  const cartKey = `${currentModalProduct.id}_${colorStr}_${sizeStr}`;
  
  const exists = cart.find(x => x.cartKey === cartKey);
  if (exists) {
    exists.qty++;
  } else {
    cart.push({
      cartKey: cartKey,
      id: currentModalProduct.id,
      title: currentModalProduct.title,
      brand: currentModalProduct.brand,
      price: currentModalProduct.price,
      color: colorStr,
      size: sizeStr,
      img: imgToSave,
      qty: 1
    });
  }
  
  updateCartUI();
  showToast("AÑADIDO AL CARRITO ✔");
  closeModal();
  document.getElementById('sidebar').classList.add('open');
}

function removeFromCart(index) {
  cart.splice(index, 1);
  updateCartUI();
}
function toggleCart() { 
  document.getElementById('sidebar').classList.toggle('open'); 
}

function updateCartUI() {
  try { localStorage.setItem('cs_cart', JSON.stringify(cart)); } catch(e) {}
  
  const totalItems = cart.reduce((acc, item) => acc + item.qty, 0);
  const badge = document.getElementById('cartBadge');
  if(badge) {
    badge.innerText = totalItems;
    badge.style.display = totalItems > 0 ? 'flex' : 'none';
  }

  const list = document.getElementById('cartList');
  const btnCheck = document.getElementById('btnCheckout');
  const tRow = document.getElementById('cartTotalRow');
  const notesW = document.getElementById('cartNotesWrap');

  if (cart.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted); font-size:0.9rem; letter-spacing:1px;">CARRITO VACÍO</div>';
    if(btnCheck) btnCheck.style.display = 'none';
    if(tRow) tRow.style.display = 'none';
    if(notesW) notesW.style.display = 'none';
    return;
  }

  if(btnCheck) btnCheck.style.display = 'block';
  if(tRow) tRow.style.display = 'flex';
  if(notesW) notesW.style.display = 'block';

  let totalMoney = 0;
  list.innerHTML = cart.map((c, i) => {
    totalMoney += c.price * c.qty;
    const details = [c.color, c.size].filter(Boolean).join(' | ');
    return `
      <div class="cart-item">
        <img class="cart-item-img" src="${c.img}" alt="Prenda">
        <div class="cart-item-info">
          <div class="cart-item-title">${c.title}</div>
          <div class="cart-item-meta">${details}</div>
          <div class="cart-item-bottom">
            <div class="cart-item-price">$${(c.price * c.qty).toFixed(2)}</div>
            <div style="display:flex; gap:10px; align-items:center;">
              <span style="font-size:0.8rem; font-weight:700;">x${c.qty}</span>
              <button class="cart-item-remove" onclick="removeFromCart(${i})">Quitar</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('cartTotal').innerText = `$${totalMoney.toFixed(2)}`;
}

// ── Procesar Pago → abre modal de checkout ──
function sendOrder() {
  if (cart.length === 0) return;
  // Cierra el sidebar antes de abrir el modal de checkout
  document.getElementById('sidebar').classList.remove('open');
  setTimeout(() => openCheckoutModal('cart'), 220);
}

/* ── Enlaces Corregidos Redes Sociales Animación (IG y TikTok) ── */
const socialIcons = [
  "https://lh3.googleusercontent.com/d/1eKil-1X4fIxl99j4ySccZWsaPxEqJ6ui", // Instagram
  "https://lh3.googleusercontent.com/d/1jnHS-gKM1FzcwFXwijIN8zfPGRGHcFE5"  // TikTok
];
let currentIconIndex = 0;

setInterval(() => {
  const iconEl = document.getElementById('bubbleIcon');
  if(!iconEl) return;
  iconEl.style.opacity = 0;
  setTimeout(() => {
    currentIconIndex = (currentIconIndex + 1) % socialIcons.length;
    iconEl.src = socialIcons[currentIconIndex];
    iconEl.style.opacity = 1;
  }, 300); 
}, 4000);

function toggleSocialMenu() {
  const menu = document.getElementById('socialMenu');
  if(menu) {
    const isHidden = (menu.style.display === 'none' || menu.style.display === '');
    menu.style.display = isHidden ? 'flex' : 'none';
  }
}

// Arranque
loadData();

// ── Compartir Producto ──
function shareProduct() {
  if (!currentModalProduct) return;
  const p = currentModalProduct;
  const shareData = {
    title: `${p.brand} — ${p.title}`,
    text: `👕 *${p.title}*\n💰 $${p.price.toFixed(2)}\n\n¡Míralo en Chilling Street!`,
    url: window.location.href
  };
  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
  } else {
    // Fallback: copiar al portapapeles
    const text = `${shareData.text}\n${shareData.url}`;
    navigator.clipboard.writeText(text).then(() => {
      showToast("🔗 ENLACE COPIADO AL PORTAPAPELES");
    }).catch(() => {
      showToast("🔗 " + shareData.url);
    });
  }
}

// ── Checkout Modal ──
let checkoutMethod = null;
let checkoutSource = null; // 'cart' | 'direct'

function openCheckoutModal(source) {
  checkoutSource = source || 'cart';
  checkoutMethod = null;
  // Reset steps
  document.getElementById('checkoutStep1').style.display = 'block';
  document.getElementById('checkoutStep2').style.display = 'none';
  document.getElementById('checkoutModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeCheckoutModal() {
  document.getElementById('checkoutModal').style.display = 'none';
  document.body.style.overflow = 'auto';
}

function backToCheckoutStep1() {
  document.getElementById('checkoutStep1').style.display = 'block';
  document.getElementById('checkoutStep2').style.display = 'none';
  checkoutMethod = null;
}

function selectCheckoutMethod(method) {
  checkoutMethod = method;

  if (method === 'whatsapp') {
    closeCheckoutModal();
    _dispatchOrder(null);
    return;
  }

  // Show step 2 form
  document.getElementById('checkoutStep1').style.display = 'none';
  document.getElementById('checkoutStep2').style.display = 'block';

  // Hide all forms first
  document.getElementById('formPersonalDelivery').style.display = 'none';
  document.getElementById('formAgencia').style.display = 'none';

  const titleEl = document.getElementById('checkoutFormTitle');

  if (method === 'personal') {
    titleEl.innerText = '🤝 DATOS PARA ENTREGA PERSONAL';
    document.getElementById('formPersonalDelivery').style.display = 'block';
    document.getElementById('pd_phone_wrap').style.display = 'block';
    // Clear fields
    ['pd_nombre','pd_apellido','pd_direccion','pd_telefono'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
  } else if (method === 'delivery') {
    titleEl.innerText = '🛵 DATOS PARA DELIVERY';
    document.getElementById('formPersonalDelivery').style.display = 'block';
    document.getElementById('pd_phone_wrap').style.display = 'block';
    ['pd_nombre','pd_apellido','pd_direccion','pd_telefono'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
  } else if (method === 'agencia') {
    titleEl.innerText = '📦 DATOS PARA ENVÍO POR AGENCIA';
    document.getElementById('formAgencia').style.display = 'block';
    ['ag_nombre','ag_apellido','ag_cedula','ag_agencia','ag_codigo','ag_ciudad','ag_telefono'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
  }

  document.getElementById('checkoutNotes').value = '';
}

function submitCheckoutForm() {
  const notes = document.getElementById('checkoutNotes')?.value.trim() || '';
  let contactInfo = '';
  let valid = true;

  if (checkoutMethod === 'personal' || checkoutMethod === 'delivery') {
    const nombre = document.getElementById('pd_nombre')?.value.trim() || '';
    const apellido = document.getElementById('pd_apellido')?.value.trim() || '';
    const direccion = document.getElementById('pd_direccion')?.value.trim() || '';
    const telefono = document.getElementById('pd_telefono')?.value.trim() || '';
    if (!nombre || !apellido || !direccion || !telefono) {
      showToast("⚠️ Completa todos los campos requeridos");
      return;
    }
    const tipo = checkoutMethod === 'personal' ? 'Entrega Personal' : 'Delivery Chilling Street';
    contactInfo = `📋 *Tipo de entrega:* ${tipo}\n👤 *Nombre:* ${nombre} ${apellido}\n📍 *Dirección:* ${direccion}\n📞 *Teléfono:* ${telefono}`;
  } else if (checkoutMethod === 'agencia') {
    const nombre = document.getElementById('ag_nombre')?.value.trim() || '';
    const apellido = document.getElementById('ag_apellido')?.value.trim() || '';
    const cedula = document.getElementById('ag_cedula')?.value.trim() || '';
    const agencia = document.getElementById('ag_agencia')?.value.trim() || '';
    const codigo = document.getElementById('ag_codigo')?.value.trim() || '';
    const ciudad = document.getElementById('ag_ciudad')?.value.trim() || '';
    const telefono = document.getElementById('ag_telefono')?.value.trim() || '';
    if (!nombre || !apellido || !cedula || !agencia || !codigo || !ciudad || !telefono) {
      showToast("⚠️ Completa todos los campos requeridos");
      return;
    }
    contactInfo = `📋 *Tipo de entrega:* Envío por Agencia\n👤 *Nombre:* ${nombre} ${apellido}\n🪪 *Cédula:* ${cedula}\n🚚 *Agencia:* ${agencia}\n🔢 *Código de agencia:* ${codigo}\n🏙️ *Ciudad destino:* ${ciudad}\n📞 *Teléfono:* ${telefono}`;
  }

  closeCheckoutModal();
  _dispatchOrder(contactInfo, notes);
}

// Construye y envía el mensaje de WhatsApp
function _dispatchOrder(contactInfo, extraNotes) {
  const notesFromCart = document.getElementById('cartNotes')?.value.trim() || '';
  const finalNotes = extraNotes || notesFromCart;

  let itemList, total;

  if (checkoutSource === 'direct' && currentModalProduct) {
    // Compra directa desde modal (no usada aún, reservada)
    const p = currentModalProduct;
    const colorStr = selectedColorData ? selectedColorData.color : '';
    const sizeStr = selectedSize || 'Única';
    const spec = [colorStr && `Color: ${colorStr}`, sizeStr !== 'Única' && `Talla: ${sizeStr}`].filter(Boolean).join(', ');
    itemList = `• ${p.title}${spec ? ` (${spec})` : ''} — $${p.price.toFixed(2)}`;
    total = p.price;
  } else {
    // Desde carrito
    total = cart.reduce((acc, p) => acc + (p.price * p.qty), 0);
    itemList = cart.map(c => {
      let spec = [];
      if(c.color) spec.push(`Color: ${c.color}`);
      if(c.size && c.size !== 'Única') spec.push(`Talla: ${c.size}`);
      const specStr = spec.length ? ` (${spec.join(', ')})` : '';
      return `• ${c.title}${specStr} x${c.qty} — $${(c.price * c.qty).toFixed(2)}`;
    }).join('\n');
  }

  let msg = `⚡ *NUEVA ORDEN CHILLING STREET* ⚡\n\n`;
  msg += itemList;
  msg += `\n\n*TOTAL: $${total.toFixed(2)}*`;
  if (contactInfo) msg += `\n\n${contactInfo}`;
  if (finalNotes) msg += `\n\n📝 *Instrucciones:* ${finalNotes}`;

  window.open('https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(msg));
}
