/**!
 * Sortable
 * @author  RubaXa   <trash@rubaxa.org>
 * @license MIT
 */

(function (factory) {
    "use strict";

    if (typeof define === "function" && define.amd) {
        define(factory);
    }
    else if (typeof module != "undefined" && typeof module.exports != "undefined") {
        module.exports = factory();
    }
    else if (typeof Package !== "undefined") {
        Sortable = factory();  // export for Meteor.js
    }
    else {
        window["Sortable"] = factory();
    }
})(function () {
    "use strict";

    var dragEl,
        parentEl,
        ghostEl,
        cloneEl,
        rootEl,
        nextEl,

        scrollEl,
        scrollParentEl,

        lastEl,
        lastCSS,
        lastParentCSS,

        oldIndex,
        newIndex,

        activeGroup,
        autoScroll = {},

        tapEvt,
        touchEvt,

        moved,

        /** @const */
        RSPACE = /\s+/g,

        expando = 'Sortable' + (new Date).getTime(),

        win = window,
        document = win.document,
        parseInt = win.parseInt,

        supportDraggable = !!('draggable' in document.createElement('div')),
        supportCssPointerEvents = (function (el) {
            el = document.createElement('x');
            el.style.cssText = 'pointer-events:auto';
            return el.style.pointerEvents === 'auto';
        })(),

        _silent = false,

        abs = Math.abs,
        slice = [].slice,

        touchDragOverListeners = [],

        _autoScroll = _throttle(function (/**Event*/evt, /**Object*/options, /**HTMLElement*/rootEl) {
            // Bug: https://bugzilla.mozilla.org/show_bug.cgi?id=505521
            if (rootEl && options.scroll) {
                var el,
                    rect,
                    sens = options.scrollSensitivity,
                    speed = options.scrollSpeed,

                    x = evt.clientX,
                    y = evt.clientY,

                    winWidth = window.innerWidth,
                    winHeight = window.innerHeight,

                    vx,
                    vy
                ;

                // Delect scrollEl
                if (scrollParentEl !== rootEl) {
                    scrollEl = options.scroll;
                    scrollParentEl = rootEl;

                    if (scrollEl === true) {
                        scrollEl = rootEl;

                        do {
                            if ((scrollEl.offsetWidth < scrollEl.scrollWidth) ||
                                (scrollEl.offsetHeight < scrollEl.scrollHeight)
                            ) {
                                break;
                            }
                        } while (scrollEl = scrollEl.parentNode);
                    }
                }

                if (scrollEl) {
                    el = scrollEl;
                    rect = scrollEl.getBoundingClientRect();
                    vx = (abs(rect.right - x) <= sens) - (abs(rect.left - x) <= sens);
                    vy = (abs(rect.bottom - y) <= sens) - (abs(rect.top - y) <= sens);
                }


                if (!(vx || vy)) {
                    vx = (winWidth - x <= sens) - (x <= sens);
                    vy = (winHeight - y <= sens) - (y <= sens);

                    (vx || vy) && (el = win);
                }


                if (autoScroll.vx !== vx || autoScroll.vy !== vy || autoScroll.el !== el) {
                    autoScroll.el = el;
                    autoScroll.vx = vx;
                    autoScroll.vy = vy;

                    clearInterval(autoScroll.pid);

                    if (el) {
                        autoScroll.pid = setInterval(function () {
                            if (el === win) {
                                win.scrollTo(win.pageXOffset + vx * speed, win.pageYOffset + vy * speed);
                            } else {
                                vy && (el.scrollTop += vy * speed);
                                vx && (el.scrollLeft += vx * speed);
                            }
                        }, 24);
                    }
                }
            }
        }, 30),

        _prepareGroup = function (options) {
            var group = options.group;

            if (!group || typeof group != 'object') {
                group = options.group = {name: group};
            }

            ['pull', 'put'].forEach(function (key) {
                if (!(key in group)) {
                    group[key] = true;
                }
            });

            options.groups = ' ' + group.name + (group.put.join ? ' ' + group.put.join(' ') : '') + ' ';
        }
    ;



    /**
     * @class  Sortable
     * @param  {HTMLElement}  el
     * @param  {Object}       [options]
     */
    function Sortable(el, options) {
        if (!(el && el.nodeType && el.nodeType === 1)) {
            throw 'Sortable: `el` must be HTMLElement, and not ' + {}.toString.call(el);
        }

        this.el = el; // root element
        this.options = options = _extend({}, options);


        // Export instance
        el[expando] = this;


        // Default options
        var defaults = {
            group: Math.random(),
            sort: true,
            disabled: false,
            store: null,
            handle: null,
            scroll: true,
            scrollSensitivity: 30,
            scrollSpeed: 10,
            draggable: /[uo]l/i.test(el.nodeName) ? 'li' : '>*',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            ignore: 'a, img',
            filter: null,
            animation: 0,
            setData: function (dataTransfer, dragEl) {
                dataTransfer.setData('Text', dragEl.textContent);
            },
            dropBubble: false,
            dragoverBubble: false,
            dataIdAttr: 'data-id',
            delay: 0,
            forceFallback: false,
            fallbackClass: 'sortable-fallback',
            fallbackOnBody: false
        };


        // Set default options
        for (var name in defaults) {
            !(name in options) && (options[name] = defaults[name]);
        }

        _prepareGroup(options);

        // Bind all private methods
        for (var fn in this) {
            if (fn.charAt(0) === '_') {
                this[fn] = this[fn].bind(this);
            }
        }

        // Setup drag mode
        this.nativeDraggable = options.forceFallback ? false : supportDraggable;

        // Bind events
        _on(el, 'mousedown', this._onTapStart);
        _on(el, 'touchstart', this._onTapStart);

        if (this.nativeDraggable) {
            _on(el, 'dragover', this);
            _on(el, 'dragenter', this);
        }

        touchDragOverListeners.push(this._onDragOver);

        // Restore sorting
        options.store && this.sort(options.store.get(this));
    }


    Sortable.prototype = /** @lends Sortable.prototype */ {
        constructor: Sortable,

        _onTapStart: function (/** Event|TouchEvent */evt) {
            var _this = this,
                el = this.el,
                options = this.options,
                type = evt.type,
                touch = evt.touches && evt.touches[0],
                target = (touch || evt).target,
                originalTarget = target,
                filter = options.filter;


            if (type === 'mousedown' && evt.button !== 0 || options.disabled) {
                return; // only left button or enabled
            }

            target = _closest(target, options.draggable, el);

            if (!target) {
                return;
            }

            // get the index of the dragged element within its parent
            oldIndex = _index(target);

            // Check filter
            if (typeof filter === 'function') {
                if (filter.call(this, evt, target, this)) {
                    _dispatchEvent(_this, originalTarget, 'filter', target, el, oldIndex);
                    evt.preventDefault();
                    return; // cancel dnd
                }
            }
            else if (filter) {
                filter = filter.split(',').some(function (criteria) {
                    criteria = _closest(originalTarget, criteria.trim(), el);

                    if (criteria) {
                        _dispatchEvent(_this, criteria, 'filter', target, el, oldIndex);
                        return true;
                    }
                });

                if (filter) {
                    evt.preventDefault();
                    return; // cancel dnd
                }
            }


            if (options.handle && !_closest(originalTarget, options.handle, el)) {
                return;
            }


            // Prepare `dragstart`
            this._prepareDragStart(evt, touch, target);
        },

        _prepareDragStart: function (/** Event */evt, /** Touch */touch, /** HTMLElement */target) {
            var _this = this,
                el = _this.el,
                options = _this.options,
                ownerDocument = el.ownerDocument,
                dragStartFn;

            if (target && !dragEl && (target.parentNode === el)) {
                tapEvt = evt;

                rootEl = el;
                dragEl = target;
                parentEl = dragEl.parentNode;
                nextEl = dragEl.nextSibling;
                activeGroup = options.group;

                dragStartFn = function () {
                    // Delayed drag has been triggered
                    // we can re-enable the events: touchmove/mousemove
                    _this._disableDelayedDrag();

                    // Make the element draggable
                    dragEl.draggable = true;

                    // Chosen item
                    _toggleClass(dragEl, _this.options.chosenClass, true);

                    // Bind the events: dragstart/dragend
                    _this._triggerDragStart(touch);
                };

                // Disable "draggable"
                options.ignore.split(',').forEach(function (criteria) {
                    _find(dragEl, criteria.trim(), _disableDraggable);
                });

                _on(ownerDocument, 'mouseup', _this._onDrop);
                _on(ownerDocument, 'touchend', _this._onDrop);
                _on(ownerDocument, 'touchcancel', _this._onDrop);

                if (options.delay) {
                    // If the user moves the pointer or let go the click or touch
                    // before the delay has been reached:
                    // disable the delayed drag
                    _on(ownerDocument, 'mouseup', _this._disableDelayedDrag);
                    _on(ownerDocument, 'touchend', _this._disableDelayedDrag);
                    _on(ownerDocument, 'touchcancel', _this._disableDelayedDrag);
                    _on(ownerDocument, 'mousemove', _this._disableDelayedDrag);
                    _on(ownerDocument, 'touchmove', _this._disableDelayedDrag);

                    _this._dragStartTimer = setTimeout(dragStartFn, options.delay);
                } else {
                    dragStartFn();
                }
            }
        },

        _disableDelayedDrag: function () {
            var ownerDocument = this.el.ownerDocument;

            clearTimeout(this._dragStartTimer);
            _off(ownerDocument, 'mouseup', this._disableDelayedDrag);
            _off(ownerDocument, 'touchend', this._disableDelayedDrag);
            _off(ownerDocument, 'touchcancel', this._disableDelayedDrag);
            _off(ownerDocument, 'mousemove', this._disableDelayedDrag);
            _off(ownerDocument, 'touchmove', this._disableDelayedDrag);
        },

        _triggerDragStart: function (/** Touch */touch) {
            if (touch) {
                // Touch device support
                tapEvt = {
                    target: dragEl,
                    clientX: touch.clientX,
                    clientY: touch.clientY
                };

                this._onDragStart(tapEvt, 'touch');
            }
            else if (!this.nativeDraggable) {
                this._onDragStart(tapEvt, true);
            }
            else {
                _on(dragEl, 'dragend', this);
                _on(rootEl, 'dragstart', this._onDragStart);
            }

            try {
                if (document.selection) {
                    document.selection.empty();
                } else {
                    window.getSelection().removeAllRanges();
                }
            } catch (err) {
            }
        },

        _dragStarted: function () {
            if (rootEl && dragEl) {
                // Apply effect
                _toggleClass(dragEl, this.options.ghostClass, true);

                Sortable.active = this;

                // Drag start event
                _dispatchEvent(this, rootEl, 'start', dragEl, rootEl, oldIndex);
            }
        },

        _emulateDragOver: function () {
            if (touchEvt) {
                if (this._lastX === touchEvt.clientX && this._lastY === touchEvt.clientY) {
                    return;
                }

                this._lastX = touchEvt.clientX;
                this._lastY = touchEvt.clientY;

                if (!supportCssPointerEvents) {
                    _css(ghostEl, 'display', 'none');
                }

                var target = document.elementFromPoint(touchEvt.clientX, touchEvt.clientY),
                    parent = target,
                    groupName = ' ' + this.options.group.name + '',
                    i = touchDragOverListeners.length;

                if (parent) {
                    do {
                        if (parent[expando] && parent[expando].options.groups.indexOf(groupName) > -1) {
                            while (i--) {
                                touchDragOverListeners[i]({
                                    clientX: touchEvt.clientX,
                                    clientY: touchEvt.clientY,
                                    target: target,
                                    rootEl: parent
                                });
                            }

                            break;
                        }

                        target = parent; // store last element
                    }
                    while (parent = parent.parentNode);
                }

                if (!supportCssPointerEvents) {
                    _css(ghostEl, 'display', '');
                }
            }
        },


        _onTouchMove: function (/**TouchEvent*/evt) {
            if (tapEvt) {
                // only set the status to dragging, when we are actually dragging
                if (!Sortable.active) {
                    this._dragStarted();
                }

                // as well as creating the ghost element on the document body
                this._appendGhost();

                var touch = evt.touches ? evt.touches[0] : evt,
                    dx = touch.clientX - tapEvt.clientX,
                    dy = touch.clientY - tapEvt.clientY,
                    translate3d = evt.touches ? 'translate3d(' + dx + 'px,' + dy + 'px,0)' : 'translate(' + dx + 'px,' + dy + 'px)';

                moved = true;
                touchEvt = touch;

                _css(ghostEl, 'webkitTransform', translate3d);
                _css(ghostEl, 'mozTransform', translate3d);
                _css(ghostEl, 'msTransform', translate3d);
                _css(ghostEl, 'transform', translate3d);

                evt.preventDefault();
            }
        },

        _appendGhost: function () {
            if (!ghostEl) {
                var rect = dragEl.getBoundingClientRect(),
                    css = _css(dragEl),
                    options = this.options,
                    ghostRect;

                ghostEl = dragEl.cloneNode(true);

                _toggleClass(ghostEl, options.ghostClass, false);
                _toggleClass(ghostEl, options.fallbackClass, true);

                _css(ghostEl, 'top', rect.top - parseInt(css.marginTop, 10));
                _css(ghostEl, 'left', rect.left - parseInt(css.marginLeft, 10));
                _css(ghostEl, 'width', rect.width);
                _css(ghostEl, 'height', rect.height);
                _css(ghostEl, 'opacity', '0.8');
                _css(ghostEl, 'position', 'fixed');
                _css(ghostEl, 'zIndex', '100000');
                _css(ghostEl, 'pointerEvents', 'none');

                options.fallbackOnBody && document.body.appendChild(ghostEl) || rootEl.appendChild(ghostEl);

                // Fixing dimensions.
                ghostRect = ghostEl.getBoundingClientRect();
                _css(ghostEl, 'width', rect.width * 2 - ghostRect.width);
                _css(ghostEl, 'height', rect.height * 2 - ghostRect.height);
            }
        },

        _onDragStart: function (/**Event*/evt, /**boolean*/useFallback) {
            var dataTransfer = evt.dataTransfer,
                options = this.options;

            this._offUpEvents();

            if (activeGroup.pull == 'clone') {
                cloneEl = dragEl.cloneNode(true);
                _css(cloneEl, 'display', 'none');
                rootEl.insertBefore(cloneEl, dragEl);
            }

            if (useFallback) {

                if (useFallback === 'touch') {
                    // Bind touch events
                    _on(document, 'touchmove', this._onTouchMove);
                    _on(document, 'touchend', this._onDrop);
                    _on(document, 'touchcancel', this._onDrop);
                } else {
                    // Old brwoser
                    _on(document, 'mousemove', this._onTouchMove);
                    _on(document, 'mouseup', this._onDrop);
                }

                this._loopId = setInterval(this._emulateDragOver, 50);
            }
            else {
                if (dataTransfer) {
                    dataTransfer.effectAllowed = 'move';
                    options.setData && options.setData.call(this, dataTransfer, dragEl);
                }

                _on(document, 'drop', this);
                setTimeout(this._dragStarted, 0);
            }
        },

        _onDragOver: function (/**Event*/evt) {
            var el = this.el,
                target,
                dragRect,
                revert,
                options = this.options,
                group = options.group,
                groupPut = group.put,
                isOwner = (activeGroup === group),
                canSort = options.sort;

            if (evt.preventDefault !== void 0) {
                evt.preventDefault();
                !options.dragoverBubble && evt.stopPropagation();
            }

            moved = true;

            if (activeGroup && !options.disabled &&
                (isOwner
                    ? canSort || (revert = !rootEl.contains(dragEl)) // Reverting item into the original list
                    : activeGroup.pull && groupPut && (
                        (activeGroup.name === group.name) || // by Name
                        (groupPut.indexOf && ~groupPut.indexOf(activeGroup.name)) // by Array
                    )
                ) &&
                (evt.rootEl === void 0 || evt.rootEl === this.el) // touch fallback
            ) {
                // Smart auto-scrolling
                _autoScroll(evt, options, this.el);

                if (_silent) {
                    return;
                }

                target = _closest(evt.target, options.draggable, el);
                dragRect = dragEl.getBoundingClientRect();

                if (revert) {
                    _cloneHide(true);

                    if (cloneEl || nextEl) {
                        rootEl.insertBefore(dragEl, cloneEl || nextEl);
                    }
                    else if (!canSort) {
                        rootEl.appendChild(dragEl);
                    }

                    return;
                }


                if ((el.children.length === 0) || (el.children[0] === ghostEl) ||
                    (el === evt.target) && (target = _ghostIsLast(el, evt))
                ) {

                    if (target) {
                        if (target.animated) {
                            return;
                        }

                        targetRect = target.getBoundingClientRect();
                    }

                    _cloneHide(isOwner);

                    if (_onMove(rootEl, el, dragEl, dragRect, target, targetRect) !== false) {
                        if (!dragEl.contains(el)) {
                            el.appendChild(dragEl);
                            parentEl = el; // actualization
                        }

                        this._animate(dragRect, dragEl);
                        target && this._animate(targetRect, target);
                    }
                }
                else if (target && !target.animated && target !== dragEl && (target.parentNode[expando] !== void 0)) {
                    if (lastEl !== target) {
                        lastEl = target;
                        lastCSS = _css(target);
                        lastParentCSS = _css(target.parentNode);
                    }


                    var targetRect = target.getBoundingClientRect(),
                        width = targetRect.right - targetRect.left,
                        height = targetRect.bottom - targetRect.top,
                        floating = /left|right|inline/.test(lastCSS.cssFloat + lastCSS.display)
                            || (lastParentCSS.display == 'flex' && lastParentCSS['flex-direction'].indexOf('row') === 0),
                        isWide = (target.offsetWidth > dragEl.offsetWidth),
                        isLong = (target.offsetHeight > dragEl.offsetHeight),
                        halfway = (floating ? (evt.clientX - targetRect.left) / width : (evt.clientY - targetRect.top) / height) > 0.5,
                        nextSibling = target.nextElementSibling,
                        moveVector = _onMove(rootEl, el, dragEl, dragRect, target, targetRect),
                        after
                    ;

                    if (moveVector !== false) {
                        _silent = true;
                        setTimeout(_unsilent, 30);

                        _cloneHide(isOwner);

                        if (moveVector === 1 || moveVector === -1) {
                            after = (moveVector === 1);
                        }
                        else if (floating) {
                            var elTop = dragEl.offsetTop,
                                tgTop = target.offsetTop;

                            if (elTop === tgTop) {
                                after = (target.previousElementSibling === dragEl) && !isWide || halfway && isWide;
                            } else {
                                after = tgTop > elTop;
                            }
                        } else {
                            after = (nextSibling !== dragEl) && !isLong || halfway && isLong;
                        }

                        if (!dragEl.contains(el)) {
                            if (after && !nextSibling) {
                                el.appendChild(dragEl);
                            } else {
                                target.parentNode.insertBefore(dragEl, after ? nextSibling : target);
                            }
                        }

                        parentEl = dragEl.parentNode; // actualization

                        this._animate(dragRect, dragEl);
                        this._animate(targetRect, target);
                    }
                }
            }
        },

        _animate: function (prevRect, target) {
            var ms = this.options.animation;

            if (ms) {
                var currentRect = target.getBoundingClientRect();

                _css(target, 'transition', 'none');
                _css(target, 'transform', 'translate3d('
                    + (prevRect.left - currentRect.left) + 'px,'
                    + (prevRect.top - currentRect.top) + 'px,0)'
                );

                target.offsetWidth; // repaint

                _css(target, 'transition', 'all ' + ms + 'ms');
                _css(target, 'transform', 'translate3d(0,0,0)');

                clearTimeout(target.animated);
                target.animated = setTimeout(function () {
                    _css(target, 'transition', '');
                    _css(target, 'transform', '');
                    target.animated = false;
                }, ms);
            }
        },

        _offUpEvents: function () {
            var ownerDocument = this.el.ownerDocument;

            _off(document, 'touchmove', this._onTouchMove);
            _off(ownerDocument, 'mouseup', this._onDrop);
            _off(ownerDocument, 'touchend', this._onDrop);
            _off(ownerDocument, 'touchcancel', this._onDrop);
        },

        _onDrop: function (/**Event*/evt) {
            var el = this.el,
                options = this.options;

            clearInterval(this._loopId);
            clearInterval(autoScroll.pid);
            clearTimeout(this._dragStartTimer);

            // Unbind events
            _off(document, 'mousemove', this._onTouchMove);

            if (this.nativeDraggable) {
                _off(document, 'drop', this);
                _off(el, 'dragstart', this._onDragStart);
            }

            this._offUpEvents();

            if (evt) {
                if (moved) {
                    evt.preventDefault();
                    !options.dropBubble && evt.stopPropagation();
                }

                ghostEl && ghostEl.parentNode.removeChild(ghostEl);

                if (dragEl) {
                    if (this.nativeDraggable) {
                        _off(dragEl, 'dragend', this);
                    }

                    _disableDraggable(dragEl);

                    // Remove class's
                    _toggleClass(dragEl, this.options.ghostClass, false);
                    _toggleClass(dragEl, this.options.chosenClass, false);

                    if (rootEl !== parentEl) {
                        newIndex = _index(dragEl);

                        if (newIndex >= 0) {
                            // drag from one list and drop into another
                            _dispatchEvent(null, parentEl, 'sort', dragEl, rootEl, oldIndex, newIndex);
                            _dispatchEvent(this, rootEl, 'sort', dragEl, rootEl, oldIndex, newIndex);

                            // Add event
                            _dispatchEvent(null, parentEl, 'add', dragEl, rootEl, oldIndex, newIndex);

                            // Remove event
                            _dispatchEvent(this, rootEl, 'remove', dragEl, rootEl, oldIndex, newIndex);
                        }
                    }
                    else {
                        // Remove clone
                        cloneEl && cloneEl.parentNode.removeChild(cloneEl);

                        if (dragEl.nextSibling !== nextEl) {
                            // Get the index of the dragged element within its parent
                            newIndex = _index(dragEl);

                            if (newIndex >= 0) {
                                // drag & drop within the same list
                                _dispatchEvent(this, rootEl, 'update', dragEl, rootEl, oldIndex, newIndex);
                                _dispatchEvent(this, rootEl, 'sort', dragEl, rootEl, oldIndex, newIndex);
                            }
                        }
                    }

                    if (Sortable.active) {
                        if (newIndex === null || newIndex === -1) {
                            newIndex = oldIndex;
                        }

                        _dispatchEvent(this, rootEl, 'end', dragEl, rootEl, oldIndex, newIndex);

                        // Save sorting
                        this.save();
                    }
                }

                // Nulling
                rootEl =
                dragEl =
                parentEl =
                ghostEl =
                nextEl =
                cloneEl =

                scrollEl =
                scrollParentEl =

                tapEvt =
                touchEvt =

                moved =
                newIndex =

                lastEl =
                lastCSS =

                activeGroup =
                Sortable.active = null;
            }
        },


        handleEvent: function (/**Event*/evt) {
            var type = evt.type;

            if (type === 'dragover' || type === 'dragenter') {
                if (dragEl) {
                    this._onDragOver(evt);
                    _globalDragOver(evt);
                }
            }
            else if (type === 'drop' || type === 'dragend') {
                this._onDrop(evt);
            }
        },


        /**
         * Serializes the item into an array of string.
         * @returns {String[]}
         */
        toArray: function () {
            var order = [],
                el,
                children = this.el.children,
                i = 0,
                n = children.length,
                options = this.options;

            for (; i < n; i++) {
                el = children[i];
                if (_closest(el, options.draggable, this.el)) {
                    order.push(el.getAttribute(options.dataIdAttr) || _generateId(el));
                }
            }

            return order;
        },


        /**
         * Sorts the elements according to the array.
         * @param  {String[]}  order  order of the items
         */
        sort: function (order) {
            var items = {}, rootEl = this.el;

            this.toArray().forEach(function (id, i) {
                var el = rootEl.children[i];

                if (_closest(el, this.options.draggable, rootEl)) {
                    items[id] = el;
                }
            }, this);

            order.forEach(function (id) {
                if (items[id]) {
                    rootEl.removeChild(items[id]);
                    rootEl.appendChild(items[id]);
                }
            });
        },


        /**
         * Save the current sorting
         */
        save: function () {
            var store = this.options.store;
            store && store.set(this);
        },


        /**
         * For each element in the set, get the first element that matches the selector by testing the element itself and traversing up through its ancestors in the DOM tree.
         * @param   {HTMLElement}  el
         * @param   {String}       [selector]  default: `options.draggable`
         * @returns {HTMLElement|null}
         */
        closest: function (el, selector) {
            return _closest(el, selector || this.options.draggable, this.el);
        },


        /**
         * Set/get option
         * @param   {string} name
         * @param   {*}      [value]
         * @returns {*}
         */
        option: function (name, value) {
            var options = this.options;

            if (value === void 0) {
                return options[name];
            } else {
                options[name] = value;

                if (name === 'group') {
                    _prepareGroup(options);
                }
            }
        },


        /**
         * Destroy
         */
        destroy: function () {
            var el = this.el;

            el[expando] = null;

            _off(el, 'mousedown', this._onTapStart);
            _off(el, 'touchstart', this._onTapStart);

            if (this.nativeDraggable) {
                _off(el, 'dragover', this);
                _off(el, 'dragenter', this);
            }

            // Remove draggable attributes
            Array.prototype.forEach.call(el.querySelectorAll('[draggable]'), function (el) {
                el.removeAttribute('draggable');
            });

            touchDragOverListeners.splice(touchDragOverListeners.indexOf(this._onDragOver), 1);

            this._onDrop();

            this.el = el = null;
        }
    };


    function _cloneHide(state) {
        if (cloneEl && (cloneEl.state !== state)) {
            _css(cloneEl, 'display', state ? 'none' : '');
            !state && cloneEl.state && rootEl.insertBefore(cloneEl, dragEl);
            cloneEl.state = state;
        }
    }


    function _closest(/**HTMLElement*/el, /**String*/selector, /**HTMLElement*/ctx) {
        if (el) {
            ctx = ctx || document;
            selector = selector.split('.');

            var tag = selector.shift().toUpperCase(),
                re = new RegExp('\\s(' + selector.join('|') + ')(?=\\s)', 'g');

            do {
                if (
                    (tag === '>*' && el.parentNode === ctx) || (
                        (tag === '' || el.nodeName.toUpperCase() == tag) &&
                        (!selector.length || ((' ' + el.className + ' ').match(re) || []).length == selector.length)
                    )
                ) {
                    return el;
                }
            }
            while (el !== ctx && (el = el.parentNode));
        }

        return null;
    }


    function _globalDragOver(/**Event*/evt) {
        if (evt.dataTransfer) {
            evt.dataTransfer.dropEffect = 'move';
        }
        evt.preventDefault();
    }


    function _on(el, event, fn) {
        el.addEventListener(event, fn, false);
    }


    function _off(el, event, fn) {
        el.removeEventListener(event, fn, false);
    }


    function _toggleClass(el, name, state) {
        if (el) {
            if (el.classList) {
                el.classList[state ? 'add' : 'remove'](name);
            }
            else {
                var className = (' ' + el.className + ' ').replace(RSPACE, ' ').replace(' ' + name + ' ', ' ');
                el.className = (className + (state ? ' ' + name : '')).replace(RSPACE, ' ');
            }
        }
    }


    function _css(el, prop, val) {
        var style = el && el.style;

        if (style) {
            if (val === void 0) {
                if (document.defaultView && document.defaultView.getComputedStyle) {
                    val = document.defaultView.getComputedStyle(el, '');
                }
                else if (el.currentStyle) {
                    val = el.currentStyle;
                }

                return prop === void 0 ? val : val[prop];
            }
            else {
                if (!(prop in style)) {
                    prop = '-webkit-' + prop;
                }

                style[prop] = val + (typeof val === 'string' ? '' : 'px');
            }
        }
    }


    function _find(ctx, tagName, iterator) {
        if (ctx) {
            var list = ctx.getElementsByTagName(tagName), i = 0, n = list.length;

            if (iterator) {
                for (; i < n; i++) {
                    iterator(list[i], i);
                }
            }

            return list;
        }

        return [];
    }



    function _dispatchEvent(sortable, rootEl, name, targetEl, fromEl, startIndex, newIndex) {
        var evt = document.createEvent('Event'),
            options = (sortable || rootEl[expando]).options,
            onName = 'on' + name.charAt(0).toUpperCase() + name.substr(1);

        evt.initEvent(name, true, true);

        evt.to = rootEl;
        evt.from = fromEl || rootEl;
        evt.item = targetEl || rootEl;
        evt.clone = cloneEl;

        evt.oldIndex = startIndex;
        evt.newIndex = newIndex;

        rootEl.dispatchEvent(evt);

        if (options[onName]) {
            options[onName].call(sortable, evt);
        }
    }


    function _onMove(fromEl, toEl, dragEl, dragRect, targetEl, targetRect) {
        var evt,
            sortable = fromEl[expando],
            onMoveFn = sortable.options.onMove,
            retVal;

        evt = document.createEvent('Event');
        evt.initEvent('move', true, true);

        evt.to = toEl;
        evt.from = fromEl;
        evt.dragged = dragEl;
        evt.draggedRect = dragRect;
        evt.related = targetEl || toEl;
        evt.relatedRect = targetRect || toEl.getBoundingClientRect();

        fromEl.dispatchEvent(evt);

        if (onMoveFn) {
            retVal = onMoveFn.call(sortable, evt);
        }

        return retVal;
    }


    function _disableDraggable(el) {
        el.draggable = false;
    }


    function _unsilent() {
        _silent = false;
    }


    /** @returns {HTMLElement|false} */
    function _ghostIsLast(el, evt) {
        var lastEl = el.lastElementChild,
                rect = lastEl.getBoundingClientRect();

        return ((evt.clientY - (rect.top + rect.height) > 5) || (evt.clientX - (rect.right + rect.width) > 5)) && lastEl; // min delta
    }


    /**
     * Generate id
     * @param   {HTMLElement} el
     * @returns {String}
     * @private
     */
    function _generateId(el) {
        var str = el.tagName + el.className + el.src + el.href + el.textContent,
            i = str.length,
            sum = 0;

        while (i--) {
            sum += str.charCodeAt(i);
        }

        return sum.toString(36);
    }

    /**
     * Returns the index of an element within its parent
     * @param  {HTMLElement} el
     * @return {number}
     */
    function _index(el) {
        var index = 0;

        if (!el || !el.parentNode) {
            return -1;
        }

        while (el && (el = el.previousElementSibling)) {
            if (el.nodeName.toUpperCase() !== 'TEMPLATE') {
                index++;
            }
        }

        return index;
    }

    function _throttle(callback, ms) {
        var args, _this;

        return function () {
            if (args === void 0) {
                args = arguments;
                _this = this;

                setTimeout(function () {
                    if (args.length === 1) {
                        callback.call(_this, args[0]);
                    } else {
                        callback.apply(_this, args);
                    }

                    args = void 0;
                }, ms);
            }
        };
    }

    function _extend(dst, src) {
        if (dst && src) {
            for (var key in src) {
                if (src.hasOwnProperty(key)) {
                    dst[key] = src[key];
                }
            }
        }

        return dst;
    }


    // Export utils
    Sortable.utils = {
        on: _on,
        off: _off,
        css: _css,
        find: _find,
        is: function (el, selector) {
            return !!_closest(el, selector, el);
        },
        extend: _extend,
        throttle: _throttle,
        closest: _closest,
        toggleClass: _toggleClass,
        index: _index
    };


    /**
     * Create sortable instance
     * @param {HTMLElement}  el
     * @param {Object}      [options]
     */
    Sortable.create = function (el, options) {
        return new Sortable(el, options);
    };


    // Export
    Sortable.version = '1.4.2';
    return Sortable;
});

(function(factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as anonymous module.
        define(['jquery'], factory);
    } else if (typeof exports === 'object') {
        // Node / CommonJS
        factory(require('jquery'));
    } else {
        // Browser globals.
        factory(jQuery);
    }
})(function($) {

    'use strict';

    var $body = $('body');
    var NAMESPACE = 'qor.chooser.sortable';
    var EVENT_ENABLE = 'enable.' + NAMESPACE;
    var EVENT_CLICK = 'click.' + NAMESPACE;
    var EVENT_DISABLE = 'disable.' + NAMESPACE;
    var CLASS_CHOSE = '.select2-selection__choice';
    var CLASS_CHOSE_REMOVE = '.select2-selection__choice__remove';
    var CLASS_CHOSE_CONTAINER = '.select2-container';
    var CLASS_CHOSE_INPUT = '.select2-search__field';
    var CLASS_SORTABLE_BODY = '.qor-dragable';
    var CLASS_SORTABLE = '.qor-dragable__list';
    var CLASS_SORTABLE_HANDLE = '.qor-dragable__list-handle';
    var CLASS_SORTABLE_DELETE = '.qor-dragable__list-delete';
    var CLASS_SORTABLE_DATA = '.qor-dragable__list-data';
    var CLASS_SORTABLE_BUTTON_ADD = '.qor-dragable__button-add';
    var CLASS_BOTTOMSHEETS = '.qor-bottomsheets';
    var CLASS_PARENT = '.qor-dragable';
    var CLASS_SELECT_FIELD = '.qor-dragable__list';
    var IS_LOADED = 'sortable-select-many-loaded';
    var CLASS_MANY = 'qor-bottomsheets__select-many';
    var CLASS_DELETED_ITEM = 'qor-selected-many__deleted';

    function QorChooserSortable(element, options) {
        this.$element = $(element);
        this.options = $.extend({}, QorChooserSortable.DEFAULTS, $.isPlainObject(options) && options);
        this.init();
    }

    QorChooserSortable.prototype = {
        constructor: QorChooserSortable,

        init: function() {
            var $this = this.$element,
                select2Data = $this.data(),
                $parent = $this.parents(CLASS_SORTABLE_BODY),
                placeholderText = $this.data('placeholder'),
                self = this,
                option = {
                    minimumResultsForSearch: 8,
                    dropdownParent: $this.parent()
                };

            this.$selector = $parent.find(CLASS_SORTABLE_DATA);
            this.$sortableList = $parent.find(CLASS_SORTABLE);
            this.$parent = $parent;

            var sortEle = $parent.find(CLASS_SORTABLE)[0];

            this.sortable = window.Sortable.create(sortEle, {
                animation: 150,
                handle: CLASS_SORTABLE_HANDLE,
                filter: CLASS_SORTABLE_DELETE,
                dataIdAttr: 'data-index',

                onFilter: function(e) {
                    var $ele = $(e.item);
                    var eleIndex = $ele.data('index');

                    $ele.remove();
                    self.removeItemsFromList(eleIndex);
                },
                onUpdate: function() {
                    self.renderOption();
                }
            });

            if (select2Data.remoteData) {
                option.ajax = $.fn.select2.ajaxCommonOptions(select2Data);

                option.templateResult = function(data) {
                    var tmpl = $this.parents('.qor-field').find('[name="select2-result-template"]');
                    return $.fn.select2.ajaxFormatResult(data, tmpl);
                };

                option.templateSelection = function(data) {
                    if (data.loading) return data.text;
                    var tmpl = $this.parents('.qor-field').find('[name="select2-selection-template"]');
                    return $.fn.select2.ajaxFormatResult(data, tmpl);
                };
            }

            $this.on('change', function() {

                    setTimeout(function() {
                        $parent.find(CLASS_CHOSE).hide();
                    }, 1);

                    $(CLASS_CHOSE_INPUT).attr('placeholder', placeholderText);
                })
                .on('select2:select', function(e) {
                    self.addItems(e.params.data);
                })
                .on('select2:unselect', function(e) {
                    self.removeItems(e.params.data);
                });

            $this.select2(option);

            $parent.find(CLASS_CHOSE_CONTAINER).hide();
            $parent.find(CLASS_CHOSE).hide();
            $(CLASS_CHOSE_INPUT).attr('placeholder', placeholderText);

            this.bind();
        },

        bind: function() {
            this.$parent.on(EVENT_CLICK, CLASS_SORTABLE_BUTTON_ADD, this.show.bind(this));
        },

        unbind: function() {
            this.$parent.off(EVENT_CLICK, CLASS_SORTABLE_BUTTON_ADD, this.show);
        },

        show: function(e) {
          var $this = $(e.target).parent('.qor-dragable__button-add');
          if ($this.attr('data-selectmany-url')) {
              var data = $this.data();

              this.BottomSheets = $body.data('qor.bottomsheets');
              this.bottomsheetsData = data;

              this.$selector = data.selectId ? $(data.selectId) : $this.closest(CLASS_PARENT).find('select');
              this.$selectFeild = this.$selector.closest(CLASS_PARENT).find(CLASS_SELECT_FIELD);

              // select many templates
              this.SELECT_MANY_SELECTED_ICON = $('[name="select-many-selected-icon"]').html();
              this.SELECT_MANY_UNSELECTED_ICON = $('[name="select-many-unselected-icon"]').html();
              this.SELECT_MANY_HINT = $('[name="select-many-hint"]').html();
              this.SELECT_MANY_TEMPLATE = $('[name="select-many-template"]').html();

              data.url = data.selectmanyUrl;

              this.BottomSheets.open(data, this.handleBottomSelect.bind(this));
          } else {
              var $container = this.$parent.find(CLASS_CHOSE_CONTAINER);

              $container.show();
              this.$parent.find(CLASS_SORTABLE_BUTTON_ADD).hide();
              setTimeout(function() {
                  $container.find(CLASS_CHOSE_INPUT).click();
              }, 100);
          }
        },

        handleBottomSelect: function () {
          var $bottomsheets = $(CLASS_BOTTOMSHEETS),
          options = {
            onSelect: this.onSelectResults.bind(this),  // render selected item after click item lists
            onSubmit: this.onSubmitResults.bind(this)   // render new items after new item form submitted
          };

          $bottomsheets.qorSelectCore(options).addClass(CLASS_MANY);
          this.initItems();
        },

        onSelectResults: function (data) {
          if ($(CLASS_SORTABLE).find('li[data-index="' + data.primaryKey + '"]').size() == 0) {
            this.addItems(data);
          } else {
            this.removeItems(data);
          }
        },

        onSubmitResults: function (data) {
          this.addItems(data);
        },

        initItems: function () {
          var $tr = $(CLASS_BOTTOMSHEETS).find('tbody tr'),
              selectedIconTmpl = this.SELECT_MANY_SELECTED_ICON,
              unSelectedIconTmpl = this.SELECT_MANY_UNSELECTED_ICON,
              selectedIDs = [],
              primaryKey,
              $selectedItems = this.$selectFeild.find('[data-primary-key]').not('.' + CLASS_DELETED_ITEM);

          $selectedItems.each(function () {
            selectedIDs.push($(this).data().primaryKey);
          });

          $tr.each(function () {
            var $this = $(this),
                $td = $this.find('td:first');

            primaryKey = $this.data().primaryKey;

            if (selectedIDs.indexOf(primaryKey) !='-1') {
              $this.addClass(CLASS_SELECTED);
              $td.append(selectedIconTmpl);
            } else {
              $td.append(unSelectedIconTmpl);
            }
          });
        },

        renderItem: function(data) {
            return window.Mustache.render(QorChooserSortable.LIST_HTML, data);
        },

        renderOption: function() {
            var indexArr = this.sortable.toArray();
            var $selector = this.$parent.find(CLASS_SORTABLE_DATA);

            $selector.empty();

            window._.each(indexArr, function(id) {
                $selector.append(window.Mustache.render(QorChooserSortable.OPTION_HTML, ({
                    'value': id
                })));
            });
        },

        removeItems: function(data) {
            $(CLASS_SORTABLE).find('li[data-index="' + data.primaryKey + '"]').remove();
            this.renderOption();
        },

        removeItemsFromList: function(index) {
            this.renderOption();
        },

        addItems: function(data, isNewData) {
            data.id = data.Id || data.ID || data[Object.keys(data)[0]];
            data.value = data.Name || data.text || data.Text || data.Title || data.Code || data.Id || data.ID || data[Object.keys(data)[0]];
            this.$sortableList.append(this.renderItem(data));
            this.renderOption();

            if (isNewData) {
              this.BottomSheets.hide();
            }
        },

        destroy: function() {
            this.sortable.destroy();
            this.unbind();
            this.$element.select2('destroy').removeData(NAMESPACE);
        }
    };

    QorChooserSortable.DEFAULTS = {};

    QorChooserSortable.LIST_HTML = '<li data-index="[[primaryKey]]" data-value="[[value]]"><span>[[value]]</span><div><i class="material-icons qor-dragable__list-delete">clear</i><i class="material-icons qor-dragable__list-handle">drag_handle</i></div></li>';

    QorChooserSortable.OPTION_HTML = '<option selected value="[[value]]"></option>';

    QorChooserSortable.plugin = function(options) {
        return this.each(function() {
            var $this = $(this);
            var data = $this.data(NAMESPACE);
            var fn;

            if (!data) {

                if (/destroy/.test(options)) {
                    return;
                }

                $this.data(NAMESPACE, (data = new QorChooserSortable(this, options)));
            }

            if (typeof options === 'string' && $.isFunction(fn = data[options])) {
                fn.apply(data);
            }
        });
    };

    $(function() {
        var selector = 'select[data-toggle="qor.chooser.sortable"]';

        if ($('body').data(IS_LOADED)) {
            return;
        }

        $('body').data(IS_LOADED, true);

        $(document).
        on(EVENT_DISABLE, function(e) {
            QorChooserSortable.plugin.call($(selector, e.target), 'destroy');
        }).
        on(EVENT_ENABLE, function(e) {
            QorChooserSortable.plugin.call($(selector, e.target));
        }).
        triggerHandler(EVENT_ENABLE);
    });

    return QorChooserSortable;

});
