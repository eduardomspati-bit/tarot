// ==========================================
// SISTEMA DE AUTENTICACIÓN - TAROTIA
// ==========================================

window.API_URL_BASE = (typeof window.API_URL !== 'undefined' && window.API_URL) 
    ? window.API_URL 
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:3000'
        : 'https://tarot-613b.onrender.com';

// Token y datos del usuario
window.tarotiaToken = localStorage.getItem('tarotia_token') || null;
window.tarotiaUsuario = null;

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    crearPantallaAuth();

    // Si hay token guardado, intentar recuperar sesión
    if (window.tarotiaToken) {
        const ok = await cargarPerfil();
        if (!ok) {
            // Token inválido, limpiar
            cerrarSesion();
        }
    }
});

// ==========================================
// CREAR PANTALLA DE AUTH EN EL DOM
// ==========================================
function crearPantallaAuth() {
    if (document.getElementById('screen-auth')) return;

    const div = document.createElement('div');
    div.id = 'screen-auth';
    div.className = 'screen hidden';
    div.innerHTML = `
        <div style="text-align: center; padding: 20px 0;">
            <div class="mini-cartas" style="margin-bottom: 20px;">
                <div class="mini-carta">🌙</div>
                <div class="mini-carta">⭐</div>
                <div class="mini-carta">☀️</div>
                <div class="mini-carta">🔮</div>
            </div>
            <h2 style="color: #ffd700; margin-bottom: 5px;">✨ Bienvenido a TarotIA</h2>
            <p style="color: rgba(255,255,255,0.6); font-size: 0.9rem; margin-bottom: 30px;">
                Ingresá tu correo para acceder al Tarot Completo
            </p>
        </div>

        <div class="consulta-gratis-box" style="max-width: 400px;">
            <input type="text" id="auth-nombre" placeholder="Tu nombre (opcional)" 
                   style="width: 100%; padding: 15px; border-radius: 12px; border: 1px solid rgba(168,85,247,0.3); 
                          background: rgba(0,0,0,0.3); color: #fff; font-size: 1rem; margin-bottom: 12px; 
                          box-sizing: border-box; outline: none;">
            <input type="email" id="auth-email" placeholder="tu@email.com" 
                   style="width: 100%; padding: 15px; border-radius: 12px; border: 1px solid rgba(168,85,247,0.3); 
                          background: rgba(0,0,0,0.3); color: #fff; font-size: 1rem; margin-bottom: 15px; 
                          box-sizing: border-box; outline: none;"
                   onkeypress="if(event.key==='Enter') iniciarSesion()">
            <button class="btn-consulta-gratis" onclick="iniciarSesion()" style="width: 100%;">
                🔮 Entrar al Tarot Completo
            </button>
            <p id="auth-error" style="color: #ff6b6b; font-size: 0.85rem; margin-top: 10px; display: none;"></p>
        </div>

        <div style="text-align: center; margin-top: 25px;">
            <button onclick="volverALanding()" style="background: transparent; border: 1px solid rgba(255,255,255,0.2); 
                    color: rgba(255,255,255,0.6); padding: 10px 25px; border-radius: 20px; cursor: pointer;
                    font-size: 0.85rem;">
                ← Volver a Consulta Gratis
            </button>
        </div>
    `;

    // Insertar antes de la portada
    const container = document.querySelector('.container');
    const portada = document.getElementById('screen-portada');
    if (container && portada) {
        container.insertBefore(div, portada);
    }
}

// ==========================================
// LOGIN / REGISTRO
// ==========================================
window.iniciarSesion = async function() {
    const nombreInput = document.getElementById('auth-nombre');
    const emailInput = document.getElementById('auth-email');
    const errorEl = document.getElementById('auth-error');

    const nombre = nombreInput ? nombreInput.value.trim() : 'Consultante';
    const email = emailInput ? emailInput.value.trim().toLowerCase() : '';

    if (!email || !email.includes('@')) {
        if (errorEl) {
            errorEl.textContent = '⚠️ Ingresá un correo válido.';
            errorEl.style.display = 'block';
        }
        return;
    }

    // Mostrar spinner
    const btn = document.querySelector('#screen-auth .btn-consulta-gratis');
    if (btn) {
        btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0 auto;"></div>';
        btn.disabled = true;
    }

    try {
        // Intentar login primero
        let response = await fetch(`${window.API_URL_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        // Si no existe, registrar
        if (response.status === 404) {
            response = await fetch(`${window.API_URL_BASE}/api/auth/registrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, email })
            });
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al iniciar sesión');
        }

        // Guardar token y usuario
        window.tarotiaToken = data.token;
        window.tarotiaUsuario = data.usuario;
        localStorage.setItem('tarotia_token', data.token);
        localStorage.setItem('tarotia_email', data.usuario.email);
        localStorage.setItem('tarotia_nombre', data.usuario.nombre);

        // Actualizar UI
        actualizarUIUsuario();

        // Ir a portada
        if (typeof window.mostrarPantalla === 'function') {
            window.mostrarPantalla('screen-portada');
        }

    } catch (error) {
        console.error('Error auth:', error);
        if (errorEl) {
            errorEl.textContent = '❌ ' + error.message;
            errorEl.style.display = 'block';
        }
    } finally {
        if (btn) {
            btn.innerHTML = '🔮 Entrar al Tarot Completo';
            btn.disabled = false;
        }
    }
};

// ==========================================
// CARGAR PERFIL
// ==========================================
window.cargarPerfil = async function() {
    if (!window.tarotiaToken) return false;

    try {
        const response = await fetch(`${window.API_URL_BASE}/api/auth/perfil`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.tarotiaToken}`
            }
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                return false;
            }
            throw new Error('Error al cargar perfil');
        }

        const data = await response.json();
        window.tarotiaUsuario = data.usuario;
        actualizarUIUsuario();
        return true;

    } catch (error) {
        console.error('Error cargando perfil:', error);
        return false;
    }
};

// ==========================================
// CERRAR SESIÓN
// ==========================================
window.cerrarSesion = function() {
    window.tarotiaToken = null;
    window.tarotiaUsuario = null;
    localStorage.removeItem('tarotia_token');
    localStorage.removeItem('tarotia_email');
    localStorage.removeItem('tarotia_nombre');
    localStorage.removeItem('simularPremium');

    if (typeof window.mostrarPantalla === 'function') {
        window.mostrarPantalla('screen-landing');
    }
};

// ==========================================
// ACTUALIZAR UI CON DATOS DEL USUARIO
// ==========================================
function actualizarUIUsuario() {
    if (!window.tarotiaUsuario) return;

    // Actualizar botón de email en portada
    const btnEmail = document.querySelector('.btn-email-vinculo');
    if (btnEmail) {
        const esPremium = window.tarotiaUsuario.plan === 'Premium';
        const planIcon = esPremium ? '✨' : '🃏';
        btnEmail.innerHTML = `${planIcon} ${window.tarotiaUsuario.nombre} (${window.tarotiaUsuario.email})`;
        btnEmail.onclick = mostrarMenuUsuario;
    }
}

// ==========================================
// MENÚ DE USUARIO (click en el botón de email)
// ==========================================
window.mostrarMenuUsuario = function() {
    if (!window.tarotiaUsuario) {
        pedirEmailAlUsuario();
        return;
    }

    const esPremium = window.tarotiaUsuario.plan === 'Premium';
    const muestras = window.tarotiaUsuario.muestrasFisicasRestantes;

    let mensaje = `👤 ${window.tarotiaUsuario.nombre}\n📧 ${window.tarotiaUsuario.email}\n`;
    mensaje += `📊 Tiradas: ${window.tarotiaUsuario.totalTiradas}\n`;

    if (esPremium) {
        mensaje += `✨ Plan: PREMIUM (ilimitado)\n`;
    } else {
        mensaje += `🃏 Plan: Gratis\n`;
        mensaje += `🔮 Muestras físicas restantes: ${muestras}\n\n`;
        mensaje += `¿Querés activar Premium?`;
    }

    const opcion = confirm(mensaje + '\n\n¿Cerrar sesión?');
    if (opcion) {
        cerrarSesion();
    }
};

// ==========================================
// CANJEAR CÓDIGO PREMIUM (desde el servidor)
// ==========================================
window.canjearCodigoPremiumServer = async function(codigo) {
    if (!window.tarotiaToken) {
        alert('❌ Debes iniciar sesión primero.');
        return false;
    }

    try {
        const response = await fetch(`${window.API_URL_BASE}/api/auth/canjear-codigo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.tarotiaToken}`
            },
            body: JSON.stringify({ codigo })
        });

        const data = await response.json();

        if (!response.ok) {
            alert('❌ ' + (data.error || 'Código inválido'));
            return false;
        }

        // Actualizar token y usuario
        window.tarotiaToken = data.token;
        window.tarotiaUsuario = data.usuario;
        localStorage.setItem('tarotia_token', data.token);

        alert('✨ ¡Código premium activado con éxito! Ahora tenés acceso ilimitado.');
        actualizarUIUsuario();
        return true;

    } catch (error) {
        alert('❌ Error al canjear código: ' + error.message);
        return false;
    }
};

// ==========================================
// VERIFICAR MUESTRAS FÍSICAS (desde servidor)
// ==========================================
window.obtenerMuestrasFisicasServer = async function() {
    if (!window.tarotiaToken) return { premium: false, muestrasRestantes: 0 };

    try {
        const response = await fetch(`${window.API_URL_BASE}/api/tiradas/muestras`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.tarotiaToken}`
            }
        });

        if (!response.ok) return { premium: false, muestrasRestantes: 0 };
        return await response.json();

    } catch (error) {
        return { premium: false, muestrasRestantes: 0 };
    }
};

window.usarMuestraFisicaServer = async function() {
    if (!window.tarotiaToken) return { premium: false, muestrasRestantes: 0, error: 'No autenticado' };

    try {
        const response = await fetch(`${window.API_URL_BASE}/api/tiradas/usar-muestra`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.tarotiaToken}`
            }
        });

        const data = await response.json();

        // Actualizar usuario local
        if (window.tarotiaUsuario && data.muestrasRestantes !== undefined) {
            window.tarotiaUsuario.muestrasFisicasRestantes = data.muestrasRestantes;
        }

        return data;

    } catch (error) {
        return { premium: false, muestrasRestantes: 0, error: error.message };
    }
};

// ==========================================
// REDIRECCIONES
// ==========================================
window.volverALanding = function() {
    if (typeof window.mostrarPantalla === 'function') {
        window.mostrarPantalla('screen-landing');
    }
};

// Sobrescribir entrarAppCompleta para verificar auth
const _entrarAppOriginal = window.entrarAppCompleta;
window.entrarAppCompleta = function() {
    if (window.tarotiaToken && window.tarotiaUsuario) {
        // Ya está logueado, ir directo a portada
        if (typeof window.mostrarPantalla === 'function') {
            window.mostrarPantalla('screen-portada');
        }
    } else {
        // Mostrar pantalla de auth
        if (typeof window.mostrarPantalla === 'function') {
            window.mostrarPantalla('screen-auth');
        }
    }
};
