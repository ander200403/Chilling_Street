// Configuración y Estado
const URL_CSV_PROD = "https://docs.google.com/spreadsheets/d/1l0uryei0Z3M5b28ECbDTI8X1UbyH5l2JvZaGlUg7mGM/export?format=csv&gid=0";
const URL_CSV_VAR = "https://docs.google.com/spreadsheets/d/1l0uryei0Z3M5b28ECbDTI8X1UbyH5l2JvZaGlUg7mGM/export?format=csv&gid=129169326";
const WHATSAPP = "584125713381";

let products = [];
let variantsByProduct = {}; // Diccionario relacional

// Estado de la ventana emergente
let currentModalProduct = null;
let selectedColorData = null;
let selectedSize = null;

let cart = (function() {
  try { return JSON.parse(localStorage.getItem('cs_cart')) || []; }
  catch(e) { return []; }
})();
let favs = (function() {
  try { return JSON.parse(localStorage.getItem('cs_favs')) || []; }
  catch(e) { return []; }
})();

// Utilidades
function getStableImageUrl(rawImg) {
  if (!rawImg) return '';
  if (rawImg.indexOf('drive.google.com') !== -1) {
    const matchD = rawImg.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const matchId = rawImg.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const driveId = (matchD && matchD[1]) || (matchId && matchId[1]);
    if (driveId) return 'https://drive.google.com/thumbnail?id=' + driveId + '&sz=w600';
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

// ── Carga Dual de Datos (Promesas Simultáneas) ──
async function loadData() {
  try {
    const tstamp = new Date().getTime();
    
    // Ejecutar ambas peticiones al mismo tiempo
    const [resProd, resVar] = await Promise.all([
      fetch(URL_CSV_PROD + "&t=" + tstamp),
      fetch(URL_CSV_VAR + "&t=" + tstamp)
    ]);
    
    const rawProd = await resProd.text();
    const rawVar = await resVar.text();

    // 1. Procesar Variantes Primero
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
          
          if (!idProdPadre) return;
          if (!variantsByProduct[idProdPadre]) variantsByProduct[idProdPadre] = [];
          
          variantsByProduct[idProdPadre].push({
            idVar: idVar,
            color: colorName,
            tallas: tallasStr ? tallasStr.split(',').map(t => t.trim().toUpperCase()) : [],
            imgColor: getStableImageUrl(imgColorRaw)
          });
        });
      }
    });

    // 2. Procesar Productos Principales
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
            variants: variantsByProduct[idProd] || [] // Enlazar variantes
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

  // Lazy Load
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

// ── Lógica de Variantes en Modal ──
function openModal(idStr) {
  const p = products.find(x => String(x.id) === String(idStr));
  if(!p) return;
  
  // Reiniciar estado
  currentModalProduct = p;
  selectedColorData = null;
  selectedSize = null;

  document.getElementById('modalImg').src = p.img;
  document.getElementById('modalTitle').innerText = p.title;
  document.getElementById('modalAuthor').innerText = p.brand;
  document.getElementById('modalDesc').innerText = p.desc;
  
  const mpEl = document.getElementById('modalPrice');
  if (p.originalPrice) {
    mpEl.innerHTML = `<span class="price-original" style="font-size:1rem;">$${p.originalPrice.toFixed(2)}</span> $${p.price.toFixed(2)}`;
  } else {
    mpEl.innerText = `$${p.price.toFixed(2)}`;
  }

  // Configurar Opciones de Variante
  const cGroup = document.getElementById('colorGroup');
  const sGroup = document.getElementById('sizeGroup');
  const cOpts = document.getElementById('colorOptions');
  const sOpts = document.getElementById('sizeOptions');
  const btnAdd = document.getElementById('btnAddToCart');

  document.getElementById('selectedSizeName').innerText = "Selecciona una";
  btnAdd.innerText = "SELECCIONA TALLA";
  btnAdd.disabled = true;

  if (p.variants && p.variants.length > 0) {
    // Producto CON variantes (Hoja 2)
    cGroup.style.display = 'block';
    
    // Generar botones de colores
    cOpts.innerHTML = p.variants.map((v, i) => {
      // Intentamos pintar el botón del color exacto basado en el nombre, o gris por defecto
      const hex = v.color.toLowerCase() === 'negro' ? '#111' : (v.color.toLowerCase() === 'blanco' ? '#fff' : '#666');
      return `<button class="color-btn" style="background-color:${hex};" title="${v.color}" onclick="selectColor(${i})"></button>`;
    }).join('');
    
    // Auto-seleccionar el primer color
    selectColor(0);
  } else {
    // Producto SIN variantes de color, usar tallas globales (Col 6)
    cGroup.style.display = 'none';
    if(p.globalSizes && p.globalSizes.length > 0) {
      sGroup.style.display = 'block';
      renderSizes(p.globalSizes);
    } else {
      // Talla única o sin especificación
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
  selectedSize = null; // resetear talla al cambiar color
  
  // Actualizar UI Color
  document.getElementById('selectedColorName').innerText = selectedColorData.color;
  const btns = document.getElementById('colorOptions').querySelectorAll('.color-btn');
  btns.forEach((b, i) => b.classList.toggle('active', i === index));
  
  // Cambiar foto si la variante tiene
  if(selectedColorData.imgColor) {
    document.getElementById('modalImg').src = selectedColorData.imgColor;
  } else {
    document.getElementById('modalImg').src = currentModalProduct.img;
  }

  // Renderizar tallas de este color
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
  
  // Identificador único para el carrito que combina ID, color y talla
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

function changeQty(index, delta) {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  updateCartUI();
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

// ── Procesar Pago (WhatsApp) ──
function sendOrder() {
  if (cart.length === 0) return;
  
  const notes = document.getElementById('cartNotes')?.value.trim() || '';
  const total = cart.reduce((acc, p) => acc + (p.price * p.qty), 0);
  
  let msg = `⚡ *NUEVA ORDEN CHILLING STREET* ⚡\n\n`;
  msg += cart.map(c => {
    let spec = [];
    if(c.color) spec.push(`Color: ${c.color}`);
    if(c.size && c.size !== 'Única') spec.push(`Talla: ${c.size}`);
    const specStr = spec.length ? ` (${spec.join(', ')})` : '';
    return `• ${c.title}${specStr} x${c.qty} — $${(c.price * c.qty).toFixed(2)}`;
  }).join('\n');
  
  msg += `\n\n*TOTAL: $${total.toFixed(2)}*`;
  if (notes) msg += `\n\n📝 *Instrucciones:* ${notes}`;
  
  window.open('https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(msg));
}

// Arranque
loadData();
