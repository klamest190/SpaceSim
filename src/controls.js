// Spaceship keyboard and mouse controller (Starfield & NMS Pointer Lock Edition)
class Controls {
  constructor() {
    this.keys = {
      throttleUp: false,   // W
      throttleDown: false, // S
      rollLeft: false,     // A
      rollRight: false,    // D
      strafeLeft: false,   // Q
      strafeRight: false,  // E
      shoot: false,        // Space or Left Mouse Click
      freeLook: false,     // Right Mouse Click
      tractorBeam: false   // B
    };

    // Direct mouse movement deltas for 1:1 steering or free-look
    this.mouseDelta = {
      x: 0,
      y: 0
    };

    // Scroll wheel delta zoom
    this.zoomDelta = 0;

    this.listeners = {};
    
    // Bind event handlers
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleLockChange = this.handleLockChange.bind(this);
    
    this.isActive = false;
    this.pointerLocked = false;
  }

  start(canvas) {
    if (this.isActive) return;
    
    this.canvas = canvas;
    
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('wheel', this.handleWheel, { passive: true });
    window.addEventListener('contextmenu', this.handleContextMenu);
    document.addEventListener('pointerlockchange', this.handleLockChange);
    
    // Bind click on canvas to request pointer lock
    this.canvas.addEventListener('click', this.requestLock.bind(this));
    this.requestLock();

    this.isActive = true;
  }

  stop() {
    if (!this.isActive) return;
    
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('contextmenu', this.handleContextMenu);
    document.removeEventListener('pointerlockchange', this.handleLockChange);
    
    if (this.canvas) {
      this.canvas.removeEventListener('click', this.requestLock);
      document.exitPointerLock();
    }
    
    // Reset inputs
    Object.keys(this.keys).forEach(k => this.keys[k] = false);
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.zoomDelta = 0;
    this.pointerLocked = false;
    
    this.isActive = false;
  }

  requestLock() {
    if (this.canvas && !this.pointerLocked) {
      this.canvas.requestPointerLock();
    }
  }

  handleLockChange() {
    if (document.pointerLockElement === this.canvas) {
      this.pointerLocked = true;
    } else {
      this.pointerLocked = false;
      // Reset keyboard inputs when focus lost
      Object.keys(this.keys).forEach(k => this.keys[k] = false);
    }
  }

  // Register single-press events (e.g. toggles)
  onPress(key, callback) {
    if (!this.listeners[key]) {
      this.listeners[key] = [];
    }
    this.listeners[key].push(callback);
  }

  handleKeyDown(e) {
    let keyTriggered = null;

    switch (e.code) {
      // Throttle W / S
      case 'KeyW':
        this.keys.throttleUp = true;
        break;
      case 'KeyS':
        this.keys.throttleDown = true;
        break;
      
      // Roll A / D
      case 'KeyA':
        this.keys.rollLeft = true;
        break;
      case 'KeyD':
        this.keys.rollRight = true;
        break;

      // Dock / undock
      case 'KeyG':
        keyTriggered = 'g';
        break;

      // Strafe Q / E
      case 'KeyQ':
        this.keys.strafeLeft = true;
        break;
      case 'KeyE':
        this.keys.strafeRight = true;
        break;

      // Shooting Space
      case 'Space':
        this.keys.shoot = true;
        break;
      
      // Tractor beam B
      case 'KeyB':
        this.keys.tractorBeam = true;
        break;
      
      // System Triggers
      case 'KeyX':
        keyTriggered = 'x';
        break;
      case 'KeyH':
        keyTriggered = 'h';
        break;
      case 'KeyF':
        keyTriggered = 'f';
        break;
      case 'KeyV':
        keyTriggered = 'v';
        break;
      case 'KeyT':
        keyTriggered = 't';
        break;
      case 'KeyR':
        keyTriggered = 'r';
        break;
      case 'KeyC':
        keyTriggered = 'c';
        break;
      case 'KeyM':
        keyTriggered = 'm';
        break;
      case 'KeyN':
        keyTriggered = 'n';
        break;
      case 'KeyJ':
        keyTriggered = 'j';
        break;

      // Menu navigation (nav computer)
      case 'ArrowUp':
        keyTriggered = 'up';
        break;
      case 'ArrowDown':
        keyTriggered = 'down';
        break;
      case 'Enter':
      case 'NumpadEnter':
        keyTriggered = 'enter';
        break;
      case 'Escape':
        keyTriggered = 'escape';
        break;
    }

    if (e.repeat && keyTriggered && !['up', 'down'].includes(keyTriggered)) return;

    if (keyTriggered && this.listeners[keyTriggered]) {
      this.listeners[keyTriggered].forEach(cb => cb());
    }
  }

  handleKeyUp(e) {
    switch (e.code) {
      case 'KeyW':
        this.keys.throttleUp = false;
        break;
      case 'KeyS':
        this.keys.throttleDown = false;
        break;
      case 'KeyA':
        this.keys.rollLeft = false;
        break;
      case 'KeyD':
        this.keys.rollRight = false;
        break;
      case 'KeyQ':
        this.keys.strafeLeft = false;
        break;
      case 'KeyE':
        this.keys.strafeRight = false;
        break;
      case 'Space':
        this.keys.shoot = false;
        break;
      case 'KeyB':
        this.keys.tractorBeam = false;
        break;
    }
  }

  handleMouseMove(e) {
    if (!this.pointerLocked) return;

    // Track delta movement directly
    this.mouseDelta.x += e.movementX;
    this.mouseDelta.y += e.movementY;
  }

  handleMouseDown(e) {
    if (!this.pointerLocked) return;

    if (e.button === 0) {
      this.keys.shoot = true; // Left click shoots
    } else if (e.button === 2) {
      this.keys.freeLook = true; // Right click free-look
    }
  }

  handleMouseUp(e) {
    if (e.button === 0) {
      this.keys.shoot = false;
    } else if (e.button === 2) {
      this.keys.freeLook = false;
    }
  }

  handleWheel(e) {
    if (!this.pointerLocked) return;
    this.zoomDelta += e.deltaY;
  }

  handleContextMenu(e) {
    e.preventDefault(); // Stop right-click menu popping up
  }

  // Clear deltas at end of frame
  clearDeltas() {
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.zoomDelta = 0;
  }
}

export const controls = new Controls();
