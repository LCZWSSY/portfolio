/* ============================================================
   李成泽 · 个人作品集 —— 交互逻辑
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     视频资源前缀（托管开关）
     --------------------------------------------------------------
     留空字符串 = 用仓库里的同名文件（GitHub Pages，国内约 0.05 MB/s）。
     填上对象存储地址、**末尾带斜杠** = 视频改从国内存储拉，例如：
         'https://portfolio-1234567890.cos.ap-shanghai.myqcloud.com/'
     只影响 <video>；图片/证书仍在 GitHub。

     容错：HTML 里的相对路径一直保留着，所以一旦对象存储取不到
     （没传完 / 权限没开 / 地址写错），会自动回退到仓库里那份，只重试
     一次。也就是说这个开关填错不会把站点搞挂，最坏就是慢回原来的样子。
     ------------------------------------------------------------ */
  var VIDEO_BASE = '';

  /* 把 data-video 里的相对路径解析成真正要加载的地址。
     已经是 http(s) 绝对地址的原样返回；否则按 VIDEO_BASE 加前缀。 */
  function resolveVideo(src) {
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    if (!VIDEO_BASE) return src;
    return VIDEO_BASE + src.replace(/^\.?\//, '');
  }

  /* 当前这个 video 是不是正在用对象存储（用于判断该不该回退） */
  function usingRemote(el) {
    return !!(VIDEO_BASE && el && (el.currentSrc || el.src || '').indexOf(VIDEO_BASE) === 0);
  }

  var docEl = document.documentElement;

  /* ------------------------------------------------------------
     模块间共享状态：环境层把「当前尾流配色 / 速度增益」写在这里，
     光标模块每帧读它，两边就不需要互相持有引用
     ------------------------------------------------------------ */
  var ENVSTATE = {
    ready: false,
    rgb: [255, 255, 255],   // 当前尾流颜色
    gain: 1,                // 尾流强度（穿越瞬间会 > 1，让尾流拉长变亮）
    burst: 0                // 穿越特效剩余强度 0~1
  };

  /* ------------------------------------------------------------
     0. 点击真伪判定（触摸设备必备）
     手机上用手指翻页时，浏览器仍可能补发一次 click；卡片的点击处理
     会把这次「翻页动作」当成「点卡片」，灯箱突然弹出、视频被切走。
     这里记住按下时的落点，抬手位置偏离超过阈值就不认这次点击；
     键盘（Enter / Space）没有落点，一律放行。
     ------------------------------------------------------------ */
  var tapStart = { x: 0, y: 0, has: false };

  document.addEventListener('pointerdown', function (e) {
    tapStart.x = e.clientX;
    tapStart.y = e.clientY;
    tapStart.has = true;
  }, true);

  function isRealClick(e) {
    if (!e || e.detail === 0) return true;   // 键盘触发
    if (!tapStart.has) return true;          // 老浏览器拿不到落点，不误杀
    var dx = e.clientX - tapStart.x;
    var dy = e.clientY - tapStart.y;
    return dx * dx + dy * dy <= 100;         // 10px 以内才算点击
  }

  /* ------------------------------------------------------------
     把 play() 在「用户手势还有效」的这一刻发出去。
     浏览器的自动播放策略按手势有效期放行：手势一旦过期，play() 会被
     Promise 拒绝（NotAllowedError）。所以顺序必须是
     「点击 → 立刻 play()」，绝不能是「点击 → 等媒体加载完 → play()」。
     三层兜底：正常播放 → 静音重试 → 明确提示，绝不静默失败。
     ------------------------------------------------------------ */
  function playWithGesture(el, onOk, onMuted, onFail) {
    if (!el) { if (onFail) onFail(); return; }
    var p;
    try { p = el.play(); } catch (e) { if (onFail) onFail(); return; }
    if (!p || typeof p.then !== 'function') { if (onOk) onOk(); return; }   // 老浏览器
    p.then(function () {
      if (onOk) onOk();
    }, function (err) {
      if (window.console && console.warn) {
        console.warn('[video] 手势内播放被拒，改静音重试：', err && err.name, err && err.message);
      }
      el.muted = true;
      var p2;
      try { p2 = el.play(); } catch (e) { if (onFail) onFail(); return; }
      if (!p2 || typeof p2.then !== 'function') { if (onMuted) onMuted(); return; }
      p2.then(function () {
        if (onMuted) onMuted();
      }, function (err2) {
        if (window.console && console.warn) {
          console.warn('[video] 静音播放仍被拒：', err2 && err2.name, err2 && err2.message);
        }
        if (onFail) onFail();
      });
    });
  }

  /* ------------------------------------------------------------
     1. 背景视频：加载失败 / 无素材时优雅降级为动态渐变海报
     ------------------------------------------------------------ */
  var media = document.querySelector('.hero__media');
  var video = document.getElementById('heroVideo');

  function toFallback() {
    if (media) media.classList.add('is-fallback');
  }

  if (video && media) {
    // source 全部加载失败
    var sources = video.querySelectorAll('source');
    var failed = 0;
    Array.prototype.forEach.call(sources, function (s) {
      s.addEventListener('error', function () {
        failed++;
        if (failed >= sources.length) toFallback();
      });
    });

    video.addEventListener('error', toFallback);

    // 兜底：若长时间拿不到可播放数据，说明素材缺失
    var guardTimer = setTimeout(function () {
      if (video.readyState < 2) toFallback();
    }, 2200);

    video.addEventListener('loadeddata', function () {
      clearTimeout(guardTimer);
      media.classList.remove('is-fallback');
    });

    // 自动播放被拦截时静音重试
    var playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === 'function') {
      playAttempt.catch(function () {
        video.muted = true;
        var retry = video.play();
        if (retry && typeof retry.catch === 'function') {
          retry.catch(toFallback);
        }
      });
    }
  } else {
    toFallback();
  }

  /* ------------------------------------------------------------
     2. 导航：滚动状态 + 移动端抽屉
     ------------------------------------------------------------ */
  var nav = document.getElementById('nav');
  var burger = document.getElementById('navBurger');
  var navLinks = document.getElementById('navLinks');
  var progress = document.getElementById('scrollProgress');
  var ticking = false;

  function onScroll() {
    var y = window.pageYOffset || docEl.scrollTop;
    var max = docEl.scrollHeight - window.innerHeight;

    if (nav) nav.classList.toggle('is-scrolled', y > 24);
    if (progress) {
      var pct = max > 0 ? (y / max) * 100 : 0;
      progress.style.width = Math.min(pct, 100) + '%';
    }
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(onScroll);
  }, { passive: true });
  onScroll();

  function closeMenu() {
    if (!navLinks || !burger) return;
    navLinks.classList.remove('is-open');
    burger.classList.remove('is-open');
    burger.setAttribute('aria-label', '打开菜单');
  }

  if (burger && navLinks) {
    burger.addEventListener('click', function () {
      var open = navLinks.classList.toggle('is-open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    });

    navLinks.addEventListener('click', function (e) {
      if (e.target.classList.contains('nav__link')) closeMenu();
    });

    document.addEventListener('click', function (e) {
      if (!navLinks.classList.contains('is-open')) return;
      if (nav && nav.contains(e.target)) return;
      closeMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
  }

  /* ------------------------------------------------------------
     3. 滚动显现（错峰，形成节奏）
     ------------------------------------------------------------ */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if ('IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var group = el.parentElement
          ? Array.prototype.slice.call(el.parentElement.querySelectorAll('.reveal'))
          : [el];
        var idx = group.indexOf(el);
        var delay = Math.min(idx < 0 ? 0 : idx, 5) * 90;

        setTimeout(function () { el.classList.add('is-visible'); }, delay);
        revealObserver.unobserve(el);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });

    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ------------------------------------------------------------
     4. 数据卡片：数字滚动 + 跟随光晕 + 点击反馈
     ------------------------------------------------------------ */
  var cards = Array.prototype.slice.call(document.querySelectorAll('.stat-card'));

  function countNum(el) {
    var unitEl = el.querySelector('span');
    var unitHTML = unitEl ? unitEl.outerHTML : '';
    var end = parseInt(el.textContent.replace(/[^\d]/g, ''), 10);
    if (isNaN(end)) return;

    var duration = 1000;
    var startTime = null;

    function step(ts) {
      if (startTime === null) startTime = ts;
      var p = Math.min((ts - startTime) / duration, 1);
      var eased = 1 - Math.pow(2, -10 * p);
      el.innerHTML = Math.round(end * eased) + unitHTML;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  if ('IntersectionObserver' in window) {
    var numObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        countNum(entry.target);
        numObserver.unobserve(entry.target);
      });
    }, { threshold: 0.6 });

    document.querySelectorAll('.stat-card__num').forEach(function (el) {
      // 纯文字型（AI）不参与计数
      if (el.classList.contains('stat-card__num--text')) return;
      numObserver.observe(el);
    });
  }

  cards.forEach(function (card) {
    var glow = card.querySelector('.stat-card__glow');

    // 光晕跟随鼠标
    card.addEventListener('mousemove', function (e) {
      if (!glow) return;
      var r = card.getBoundingClientRect();
      var x = e.clientX - r.left;
      var y = e.clientY - r.top;
      glow.style.transform = 'translate(' + (x - 100) + 'px,' + (y - 100) + 'px)';
    });

    // 点击反馈（后续可接入详情页）
    card.addEventListener('click', function () {
      if (typeof card.animate !== 'function') return;
      card.animate(
        [
          { transform: 'translateY(-10px) scale(1.035)' },
          { transform: 'translateY(-10px) scale(.982)' },
          { transform: 'translateY(-10px) scale(1.035)' }
        ],
        { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    });
  });

  /* ------------------------------------------------------------
     5. 首屏鼠标视差（轻微、克制）
     ------------------------------------------------------------ */
  var hero = document.getElementById('home');
  var heroCenter = document.querySelector('.hero__center');
  var heroMedia = document.querySelector('.hero__media');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (hero && !reduced && window.matchMedia('(hover: hover)').matches) {
    var px = 0, py = 0, tx = 0, ty = 0, rafId = null;

    var loop = function () {
      px += (tx - px) * 0.06;
      py += (ty - py) * 0.06;

      if (heroCenter) {
        heroCenter.style.transform =
          'translate3d(' + (px * 14).toFixed(2) + 'px,' + (py * 10).toFixed(2) + 'px,0)';
      }
      if (heroMedia) {
        heroMedia.style.transform =
          'translate3d(' + (px * -20).toFixed(2) + 'px,' + (py * -14).toFixed(2) + 'px,0) scale(1.05)';
      }

      if (Math.abs(tx - px) > 0.0008 || Math.abs(ty - py) > 0.0008) {
        rafId = requestAnimationFrame(loop);
      } else {
        rafId = null;
      }
    };

    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
      if (rafId === null) rafId = requestAnimationFrame(loop);
    });

    hero.addEventListener('mouseleave', function () {
      tx = 0; ty = 0;
      if (rafId === null) rafId = requestAnimationFrame(loop);
    });
  }

  /* ------------------------------------------------------------
     6. 作品带：双向无限循环滚动
        第一排向左 / 第二排向右，无缝循环，支持悬停暂停与拖动
     ------------------------------------------------------------ */
  var tracks = Array.prototype.slice.call(document.querySelectorAll('.marquee__track'));

  function initMarquee(track) {
    var dir = track.getAttribute('data-direction') === 'right' ? -1 : 1;
    var originals = Array.prototype.slice.call(track.children);
    if (!originals.length) return;

    // 克隆整组内容拼接，使「一组宽度」成为循环周期
    var groupWidth = track.scrollWidth;

    // 内容不足一屏时多补几组，保证始终铺满
    var viewportW = track.parentElement ? track.parentElement.offsetWidth : window.innerWidth;
    var clones = Math.max(2, Math.ceil((viewportW * 2) / Math.max(groupWidth, 1)) + 1);

    for (var c = 1; c < clones; c++) {
      originals.forEach(function (node) {
        var clone = node.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('tabindex', '-1');
        track.appendChild(clone);
      });
    }

    track.classList.add('is-js');

    var offset = dir > 0 ? 0 : -groupWidth;
    var paused = false;
    var lastTs = null;
    var speed = 34; // px / 秒
    var rafId2 = null;

    function wrap(v) {
      // 把偏移量收敛到 [-groupWidth, 0)
      if (groupWidth <= 0) return v;
      v = v % groupWidth;
      if (v > 0) v -= groupWidth;
      return v;
    }

    function frame(ts) {
      if (lastTs === null) lastTs = ts;
      var dt = Math.min((ts - lastTs) / 1000, 0.05); // 限幅，防止切页后跳帧
      lastTs = ts;

      if (!paused && !drag.active) {
        offset = wrap(offset - dir * speed * dt);
      }
      track.style.transform = 'translate3d(' + offset.toFixed(2) + 'px,0,0)';
      rafId2 = requestAnimationFrame(frame);
    }

    /* --- 拖动 / 触摸滑动 --- */
    var drag = { active: false, startX: 0, startY: 0, startOffset: 0, moved: 0, axis: '' };

    function onDown(e) {
      // 鼠标只响应主键
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag.active = true;
      drag.moved = 0;
      drag.axis = '';                 // 还没判定方向
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startOffset = offset;
      if (e.pointerType === 'mouse') track.style.cursor = 'grabbing';
    }

    function onMove(e) {
      if (!drag.active) return;
      var dx = e.clientX - drag.startX;
      var dy = e.clientY - drag.startY;

      // 手指刚落下时先判方向：纵向为主说明用户想翻页，马上交还，别抢滚动
      if (!drag.axis) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (drag.axis === 'y') { drag.active = false; return; }
      }

      drag.moved = Math.abs(dx);
      offset = wrap(drag.startOffset + dx);
      track.style.transform = 'translate3d(' + offset.toFixed(2) + 'px,0,0)';
      if (drag.moved > 4) e.preventDefault();
    }

    function onUp() {
      if (!drag.active) return;
      drag.active = false;
      track.style.cursor = '';
      // 拖动距离很小时视为点击，交给卡片的 click 处理
      if (drag.moved > 6) {
        var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
        track.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(function () {
          track.removeEventListener('click', swallow, { capture: true });
        }, 0);
      }
    }

    track.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    // 暂停用「原因集合」管理：悬停 / 焦点 / 页面隐藏各自登记，任一条解除就恢复滚动。
    // 早先是一个布尔量，谁最后写谁说了算 —— 手机上合成出来的 mouseenter
    // 会把整条带子永久冻住（mouseleave 不会来），看上去就是一排静止重复的卡片。
    var pauseReasons = {};

    function setPaused(reason, on) {
      if (on) pauseReasons[reason] = true; else delete pauseReasons[reason];
      paused = Object.keys(pauseReasons).length > 0;
      if (!paused) lastTs = null;
    }

    // 悬停暂停：只认真正的鼠标（触摸设备不要听 mouseenter，那是合成事件）
    track.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'mouse') setPaused('hover', true);
    });
    track.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') setPaused('hover', false);
    });

    // 焦点在卡片上时也暂停，方便键盘操作
    track.addEventListener('focusin', function () { setPaused('focus', true); });
    track.addEventListener('focusout', function () { setPaused('focus', false); });

    // 页面不可见时暂停，回到前台要恢复 —— 只暂停不恢复会让带子永久静止
    document.addEventListener('visibilitychange', function () {
      setPaused('hidden', document.hidden);
    });

    rafId2 = requestAnimationFrame(frame);

    function railWidth() {
      return track.parentElement ? track.parentElement.offsetWidth : window.innerWidth;
    }

    // 视口宽度大变（横竖屏切换等）就按当前宽度重建克隆：
    // 否则循环周期和实际组宽对不上，接缝处会露出重复的卡片或空白。
    function rebuild() {
      Array.prototype.slice.call(track.children).forEach(function (c) {
        if (c.getAttribute('aria-hidden') === 'true') track.removeChild(c);
      });
      groupWidth = track.scrollWidth;
      clones = Math.max(2, Math.ceil((railWidth() * 2) / Math.max(groupWidth, 1)) + 1);
      for (var c = 1; c < clones; c++) {
        originals.forEach(function (node) {
          var clone = node.cloneNode(true);
          clone.setAttribute('aria-hidden', 'true');
          clone.setAttribute('tabindex', '-1');
          track.appendChild(clone);
        });
      }
      offset = wrap(offset);
    }

    var resizeTimer = null;
    var lastRailW = railWidth();
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var w = railWidth();
        if (Math.abs(w - lastRailW) > 100) {
          lastRailW = w;
          rebuild();
        } else {
          offset = wrap(offset);
        }
      }, 200);
    });
  }

  if (tracks.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    tracks.forEach(initMarquee);
  }

  /* ------------------------------------------------------------
     6.5 作品卡片封面图（可选）
         约定：assets/covers/work-01.jpg 配 assets/videos/work-01.mp4，
               assets/covers/proj-01.jpg 配 assets/videos/proj-01.mp4。
         路径直接由 data-video 推导，所以增删卡片时不用另维护一份封面路径；
         也可以用 data-cover 单独指定某张卡。
         没有图 / 加载失败就整块移除，露出底下程序生成的抽象图形 —— 不会出现破图。
         注意必须放在作品带克隆之后：克隆出来的卡也要各自挂封面。
     ------------------------------------------------------------ */
  (function initCovers() {
    // 每项：[卡片选择器, 封面容器选择器]
    var kinds = [
      ['.work-card', '.work-card__cover'],
      ['.proj-card', '.proj-card__cover']
    ];
    kinds.forEach(function (kind) {
      Array.prototype.forEach.call(document.querySelectorAll(kind[0]), function (card) {
        var cover = card.querySelector(kind[1]);
        if (!cover || cover.querySelector('img')) return;

        var name = (card.getAttribute('data-video') || '').match(/([^\/\\]+)\.(?:mp4|webm|mov|m4v)$/i);
        var src = card.getAttribute('data-cover') || (name ? 'assets/covers/' + name[1] + '.jpg' : '');
        if (!src) return;

        var img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.loading = 'lazy';
        img.addEventListener('error', function () {
          if (img.parentNode) img.parentNode.removeChild(img);
        }, { once: true });
        img.src = src;
        cover.appendChild(img);
      });
    });
  })();

  /* ------------------------------------------------------------
     7. 弹层：作品视频 / 荣誉证书图片（按 data-* 自动切换）
     ------------------------------------------------------------ */
  var lightbox = document.getElementById('lightbox');
  var lightboxVideo = document.getElementById('lightboxVideo');
  var lightboxImage = document.getElementById('lightboxImage');
  var lightboxEmpty = document.getElementById('lightboxEmpty');
  var lightboxEmptyTitle = document.getElementById('lightboxEmptyTitle');
  var lightboxEmptyDesc = document.getElementById('lightboxEmptyDesc');
  var lightboxTitle = document.getElementById('lightboxTitle');
  var lightboxMeta = document.getElementById('lightboxMeta');
  var lastFocused = null;

  function openLightbox(card) {
    if (!lightbox) return;
    lastFocused = document.activeElement;

    var title = card.getAttribute('data-title') || '作品';
    var category = card.getAttribute('data-category') || '';
    // 带 data-image 的（荣誉证书）走图片模式，其余走视频模式
    var imgSrc = card.getAttribute('data-image') || '';
    var src = imgSrc ? '' : (card.getAttribute('data-video') || '');

    if (lightboxTitle) lightboxTitle.textContent = title;
    if (lightboxMeta) lightboxMeta.textContent = category;

    // 先把两种媒体都收起，避免上一张的内容闪一下
    if (lightboxVideo) {
      lightboxVideo.hidden = true;
      lightboxVideo.removeAttribute('src');
    }
    if (lightboxImage) {
      lightboxImage.hidden = true;
      lightboxImage.removeAttribute('src');
    }
    lightbox.classList.toggle('is-image', !!imgSrc);
    lightbox.classList.remove('is-muted', 'is-blocked');
    if (lightboxEmpty) lightboxEmpty.hidden = false;
    if (lightboxEmptyTitle) {
      lightboxEmptyTitle.textContent = imgSrc ? '证书图片待上传' : '视频即将上线';
    }
    if (lightboxEmptyDesc) {
      lightboxEmptyDesc.textContent = imgSrc
        ? '把证书图片放入 assets/certs 目录即可自动显示'
        : '把视频文件放入 assets/videos 目录即可自动播放';
    }

    if (imgSrc && lightboxImage) {
      lightboxImage.alt = title;
      lightboxImage.addEventListener('load', function () {
        lightboxImage.hidden = false;
        if (lightboxEmpty) lightboxEmpty.hidden = true;
      }, { once: true });
      lightboxImage.addEventListener('error', function () {
        lightboxImage.hidden = true;
        if (lightboxEmpty) lightboxEmpty.hidden = false;
      }, { once: true });
      lightboxImage.src = imgSrc;
    } else if (src && lightboxVideo) {
      lightboxVideo.muted = false;
      lightboxVideo.hidden = false;                     // 立刻显示：原生控件第一时间可用，
      if (lightboxEmpty) lightboxEmpty.hidden = true;   // 不必干等到 loadeddata

      var lbLocal = src;
      lightboxVideo.setAttribute('data-local-src', lbLocal);

      lightboxVideo.addEventListener('error', function () {
        // 对象存储取不到就回退仓库副本，只重试一次
        if (usingRemote(lightboxVideo) && lbLocal) {
          if (window.console && console.warn) {
            console.warn('[video] 灯箱：对象存储取不到，回退仓库副本：', lbLocal);
          }
          lightboxVideo.src = lbLocal;
          lightboxVideo.load();
          var p3 = lightboxVideo.play();
          if (p3 && typeof p3.catch === 'function') p3.catch(function () {});
          return;
        }
        lightboxVideo.hidden = true;
        if (lightboxEmpty) {
          lightboxEmpty.hidden = false;
          if (lightboxEmptyTitle) lightboxEmptyTitle.textContent = '视频加载失败';
          if (lightboxEmptyDesc) {
            lightboxEmptyDesc.textContent = '网络较慢时容易超时，关掉弹层再点一次卡片即可重试';
          }
        }
      });

      lightboxVideo.src = resolveVideo(src);
      lightboxVideo.load();

      // 同实习大屏：play() 就在这次点击的手势里发出去。
      // 拖到 loadeddata 再播，手势过期后会被浏览器拒绝、且毫无提示。
      playWithGesture(lightboxVideo, null,
        function () { lightbox.classList.add('is-muted'); },    // 静音兜底
        function () { lightbox.classList.add('is-blocked'); }); // 只能手动点控件
    }

    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');

    var closeBtn = lightbox.querySelector('.lightbox__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeLightbox() {
    if (!lightbox || !lightbox.classList.contains('is-open')) return;

    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');

    if (lightboxVideo) {
      lightboxVideo.pause();
      lightboxVideo.removeAttribute('src');
      lightboxVideo.load();
    }
    if (lightboxImage) {
      lightboxImage.hidden = true;
      lightboxImage.removeAttribute('src');
    }
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  if (lightbox) {
    // 所有作品卡片（含克隆 / 项目作品卡 / 荣誉证书卡）统一用事件委托
    // 注意：无限循环用的克隆卡带 aria-hidden（供读屏跳过，键盘 tabindex=-1 也已排除），
    // 但它和真卡长得一模一样，鼠标点击必须照常打开 —— 早先这里连 aria-hidden 一起挡掉，
    // 导致滚动到「克隆那一段」时整排卡片点了没反应。
    document.addEventListener('click', function (e) {
      // 只认真正的点击：手机上翻页时补发的 click 位移很大，不算
      if (!isRealClick(e)) return;
      var card = e.target.closest ? e.target.closest('.work-card, .proj-card, .honor-card') : null;
      if (!card) return;
      openLightbox(card);
    });

    lightbox.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeLightbox();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLightbox();
    });
  }

  /* ------------------------------------------------------------
     8. 自定义光标 · 纸飞机 + 光带拖尾
     ------------------------------------------------------------ */
  var cursorEl = document.getElementById('cursor');
  var cursorPlane = document.getElementById('cursorPlane');
  var trailCanvas = document.getElementById('cursorTrail');
  var cursorDot = document.getElementById('cursorDot');

  // 仅在支持精确指针的设备启用
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var cursorReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (cursorEl && cursorPlane && finePointer && !cursorReduced) {
    document.body.classList.add('has-custom-cursor');

    var curX = window.innerWidth / 2, curY = window.innerHeight / 2;
    var prevX = curX, prevY = curY;
    var targetX = curX, targetY = curY;
    var currentRot = -90;
    var targetRot = -90;
    var cursorActive = false;
    var cursorRaf = null;

    // 可交互元素选择器
    var HOVER_SEL = 'a, button, .work-card, .stat-card, .filter, input, textarea, select, [role="button"], .explore';

    function lerp(a, b, t) { return a + (b - a) * t; }

    /* ---------- 光带拖尾（canvas） ---------- */
    var ctx = null;
    var trailPts = [];        // 光带轨迹点
    var TRAIL_MAX = 48;       // 轨迹点上限（越多尾巴越长）
    var dpr = 1;

    function setupCanvas() {
      if (!trailCanvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      trailCanvas.width = Math.floor(window.innerWidth * dpr);
      trailCanvas.height = Math.floor(window.innerHeight * dpr);
      ctx = trailCanvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    }

    /* 用二次贝塞尔平滑连接轨迹点，画出连续光带 */
    function drawTrail() {
      if (!ctx || !trailCanvas) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      if (trailPts.length < 3) return;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 颜色与强度由环境层决定：云海里是白色凝结尾，森林里偏嫩绿，星空里偏金紫
      var c = ENVSTATE.rgb;
      var gain = ENVSTATE.gain;
      var rgb = c[0] + ',' + c[1] + ',' + c[2];

      // 分段绘制：一条淡淡的长线
      // 越靠近飞机越实，越远越淡；整体保持低不透明度，避免抢画面
      for (var i = 1; i < trailPts.length - 1; i++) {
        var t = i / (trailPts.length - 1);   // 0 = 最旧, 1 = 最新
        var p0 = trailPts[i];
        var p1 = trailPts[i + 1];

        // 1.35 次幂：比 2.0 平缓，尾巴后半段也保持可见，线才"长"
        var alpha = Math.pow(t, 1.35) * 0.5 * gain;
        var width = (Math.pow(t, 1.3) * 5 + 0.7) * gain;

        // 外层柔光：极淡的雾，负责"长线"的体量感
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = 'rgba(' + rgb + ', ' + Math.min(alpha * 0.22, 1).toFixed(3) + ')';
        ctx.lineWidth = width * 2.6;
        ctx.stroke();

        // 内层亮芯：是这条线的主体
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = 'rgba(' + rgb + ', ' + Math.min(alpha * 0.62, 1).toFixed(3) + ')';
        ctx.lineWidth = width * 0.6;
        ctx.stroke();
      }

      // 机头处的柔亮点（收束尾流，让线有起点）
      var head = trailPts[trailPts.length - 1];
      var g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 14 * gain);
      g.addColorStop(0, 'rgba(' + rgb + ', ' + Math.min(.5 * gain, 1).toFixed(2) + ')');
      g.addColorStop(0.45, 'rgba(' + rgb + ', ' + Math.min(.16 * gain, 1).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(' + rgb + ', 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 14 * gain, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---------- 主循环 ---------- */
    function cursorLoop() {
      // 位置缓动
      curX = lerp(curX, targetX, 0.3);
      curY = lerp(curY, targetY, 0.3);

      // 朝向：机头对准移动方向
      var dx = targetX - prevX;
      var dy = targetY - prevY;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 2) {
        // 当前造型机头朝正上方（-90°），因此移动方向角需补偿 +90°
        targetRot = Math.atan2(dy, dx) * 180 / Math.PI + 90;
        prevX = targetX;
        prevY = targetY;
      }

      // 最短路径角度插值
      var diff = targetRot - currentRot;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      currentRot = lerp(currentRot, currentRot + diff, 0.16);

      cursorEl.style.setProperty('--cx', curX.toFixed(2) + 'px');
      cursorEl.style.setProperty('--cy', curY.toFixed(2) + 'px');
      cursorPlane.style.setProperty('--plane-rot', currentRot.toFixed(2) + 'deg');

      // 记录光带轨迹点
      if (cursorActive) {
        var last = trailPts[trailPts.length - 1];
        if (!last || Math.abs(last.x - curX) > 1.2 || Math.abs(last.y - curY) > 1.2) {
          trailPts.push({ x: curX, y: curY });
          // 穿越瞬间把尾巴放长，飞行感更强
          var cap = ENVSTATE.gain > 1.04 ? Math.round(TRAIL_MAX * 1.7) : TRAIL_MAX;
          while (trailPts.length > cap) trailPts.shift();
        }
      } else {
        trailPts.length = 0;
      }

      drawTrail();
      cursorRaf = requestAnimationFrame(cursorLoop);
    }

    setupCanvas();

    /* ---------- 指针事件 ---------- */
    document.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      targetX = e.clientX;
      targetY = e.clientY;

      if (!cursorActive) {
        cursorActive = true;
        curX = prevX = targetX;
        curY = prevY = targetY;
        trailPts.length = 0;
        cursorEl.classList.add('is-active');
        if (trailCanvas) trailCanvas.classList.add('is-active');
        if (cursorRaf === null) cursorRaf = requestAnimationFrame(cursorLoop);
      }

      var el = e.target;
      var hovering = el && el.closest ? !!el.closest(HOVER_SEL) : false;
      cursorEl.classList.toggle('is-hover', hovering);
    }, { passive: true });

    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      cursorEl.classList.add('is-down');
      burst();
    }, { passive: true });

    document.addEventListener('pointerup', function () {
      cursorEl.classList.remove('is-down');
    }, { passive: true });

    // 鼠标移出窗口时隐藏
    docEl.addEventListener('mouseleave', function () {
      cursorActive = false;
      trailPts.length = 0;
      cursorEl.classList.remove('is-active');
      if (trailCanvas) trailCanvas.classList.remove('is-active');
      if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    });

    /* 点击冲击环 */
    function burst() {
      var ring = document.createElement('span');
      ring.className = 'cursor__ring is-burst';
      cursorEl.appendChild(ring);
      setTimeout(function () { ring.remove(); }, 600);
    }

    /* 选中文字时临时恢复系统光标（节流） */
    var selTimer = null;
    document.addEventListener('selectionchange', function () {
      clearTimeout(selTimer);
      selTimer = setTimeout(function () {
        var sel = window.getSelection();
        var hasText = sel && sel.toString().length > 0;
        document.body.classList.toggle('is-selecting', !!hasText);
      }, 120);
    });

    /* 窗口尺寸变化时重设画布 */
    var canvasResizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(canvasResizeTimer);
      canvasResizeTimer = setTimeout(setupCanvas, 160);
    });

    /* 页面隐藏时停掉循环，省电 */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (cursorRaf !== null) {
          cancelAnimationFrame(cursorRaf);
          cursorRaf = null;
        }
      } else if (cursorRaf === null && cursorActive) {
        cursorRaf = requestAnimationFrame(cursorLoop);
      }
    });
  }

  /* ------------------------------------------------------------
     9. 抽卡展示区（实习经历 · 内容作品）
     —— 大屏位置固定，点卡牌只换大屏内的视频
     ------------------------------------------------------------ */
  var drawCards = document.querySelectorAll('.draw-card');
  if (drawCards.length) {

    // 记录每个舞台（A / B / C）当前选中的卡
    var drawState = {};

    function initDrawCard(card) {
      var key = card.getAttribute('data-target');
      var name = card.getAttribute('data-name') || '未选择';
      var src = card.getAttribute('data-video');

      var videoEl = document.getElementById('drawVideo' + key);
      // 底层模糊垫图（竖屏素材在横向大屏里的填充），同一 src、静音
      var videoBg = document.getElementById('drawVideo' + key + 'Bg');
      var emptyEl = document.getElementById('drawEmpty' + key);
      var nameEl = document.getElementById('drawName' + key);
      var countEl = document.getElementById('drawCount' + key);
      var stage = videoEl ? videoEl.closest('.draw__screen') : null;
      if (!videoEl || !stage) return;

      // 该舞台共有多少张卡（用于计数）
      var siblings = document.querySelectorAll('.draw-card[data-target="' + key + '"]');

      // 只看一次：初始化计数器
      if (!drawState[key]) {
        drawState[key] = { index: -1, hasVideo: false };
        if (countEl) countEl.textContent = '0 / ' + siblings.length;
      }

      // 找出这张卡在组内的序号
      var idx = -1;
      for (var i = 0; i < siblings.length; i++) {
        if (siblings[i] === card) { idx = i; break; }
      }

      // 第一张卡自动选中并加载首帧（大屏不空着），但**不自动播放**：
      // 自动播放会让浏览器拦下带声音的主视频、却放行静音的底层垫图，
      // 结果大屏上有一层没人点过却自己在动的画面。播放一律等点击。
      if (!drawState[key].inited) {
        drawState[key].inited = true;
        loadInto(card, idx, siblings.length, false);
      }

      card.addEventListener('click', function (e) {
        if (!isRealClick(e)) return;      // 翻页时的误触不算
        loadInto(card, idx, siblings.length, true);
      });

      // 底层垫图与主画面同步：暂停 / 拖进度条时别各跑各的
      videoEl.addEventListener('play', function () {
        if (!videoBg) return;
        var pb1 = videoBg.play();
        if (pb1 && typeof pb1.catch === 'function') pb1.catch(function () {});
      });
      videoEl.addEventListener('pause', function () { if (videoBg) videoBg.pause(); });
      videoEl.addEventListener('seeked', function () {
        if (!videoBg) return;
        try { videoBg.currentTime = videoEl.currentTime; } catch (e) {}
      });

      function loadInto(c, i, total, shouldPlay) {
        // 清掉同组其它卡的高亮
        for (var j = 0; j < siblings.length; j++) {
          siblings[j].classList.remove('is-active');
        }
        c.classList.add('is-active');
        c.classList.add('is-drawn');
        setTimeout(function () { c.classList.remove('is-drawn'); }, 520);

        drawState[key].index = i;

        // 换源：大屏本身不动，只换里面的内容
        if (emptyEl) emptyEl.classList.remove('is-hidden');
        videoEl.classList.remove('is-ready');
        stage.classList.remove('is-playing');
        stage.classList.remove('is-loaded');

        if (nameEl) nameEl.textContent = name;
        if (countEl) countEl.textContent = (i + 1) + ' / ' + total;

        if (!src) return;

        var remoteSrc = resolveVideo(src);
        videoEl.setAttribute('data-local-src', src);   // 回退用，只重试一次

        videoEl.pause();
        videoEl.src = remoteSrc;
        videoEl.load();

        // 底层垫图只跟着换源，自己不播 —— 它一旦自动播放，大屏上就会有
        // 一层「没人点过却在动」的模糊画面。播放/暂停由主视频的事件同步。
        if (videoBg) {
          videoBg.pause();
          videoBg.src = remoteSrc;
          videoBg.load();
        }

        // 首帧就绪：把画面亮出来（静止）。播放不在这里发起，见下方 startPlay。
        videoEl.onloadeddata = function () {
          videoEl.classList.add('is-ready');
          if (!shouldPlay) {
            stage.classList.remove('is-playing');
            stage.classList.add('is-loaded');
            if (emptyEl) emptyEl.classList.remove('is-hidden');
          }
        };
        videoEl.onerror = function () {
          // ① 先试回退：对象存储取不到就换回仓库里那份（只重试一次）
          var localSrc = videoEl.getAttribute('data-local-src') || '';
          if (usingRemote(videoEl) && localSrc) {
            if (window.console && console.warn) {
              console.warn('[video] 对象存储取不到，回退仓库副本：', localSrc);
            }
            videoEl.src = localSrc;
            videoEl.load();
            if (videoBg) { videoBg.src = localSrc; videoBg.load(); }
            return;
          }
          // ② 两边都取不到，才认输并明确提示
          videoEl.classList.remove('is-ready');
          stage.classList.remove('is-playing');
          stage.classList.remove('is-loaded');
          stage.classList.remove('is-blocked');
          if (emptyEl) {
            emptyEl.classList.remove('is-hidden');
            var t = emptyEl.querySelector('.draw__empty-title');
            if (t) t.textContent = '该作品视频待上传';
          }
        };

        if (shouldPlay) {
          // 就在点击的这一刻播，绝不拖到 loadeddata（拖过去手势就过期了）
          startPlay();
        } else {
          stage.classList.remove('is-playing');
          stage.classList.add('is-loaded');
          if (emptyEl) emptyEl.classList.remove('is-hidden');
        }
      }

      /* ----------------------------------------------------------
         开始播放。要害是「当场调用 play()」——见文件上方 playWithGesture
         的说明。播不了时给出明确出口，不留一个没反应的死画面。
         ---------------------------------------------------------- */
      function startPlay() {
        stage.classList.remove('is-loaded');
        stage.classList.remove('is-blocked');
        stage.classList.add('is-playing');
        if (emptyEl) emptyEl.classList.add('is-hidden');
        playWithGesture(videoEl,
          function () {                                  // 正常出声播放
            if (videoBg) { try { videoBg.play(); } catch (e) {} }
          },
          function () {                                  // 静音兜底：画面对就行
            stage.classList.add('is-muted');
            if (videoBg) { try { videoBg.play(); } catch (e) {} }
          },
          function () {                                  // 真播不了：明说，别装死
            stage.classList.remove('is-playing');
            stage.classList.add('is-blocked');
            if (emptyEl) {
              emptyEl.classList.remove('is-hidden');
              var t = emptyEl.querySelector('.draw__empty-title');
              if (t) t.textContent = '点这里播放';
            }
          });
      }

      // 大屏本身也能点：用户在视频画面上点一下就该有反应，
      // 不该只有旁边那一列小卡片可点
      stage.addEventListener('click', function (e) {
        if (e.target === videoEl) {
          var r = videoEl.getBoundingClientRect();
          if (e.clientY > r.bottom - 56) return;         // 落在原生控件条上，别抢
        }
        if (videoEl.paused) startPlay();
        else videoEl.pause();
      });
    }

    for (var dc = 0; dc < drawCards.length; dc++) initDrawCard(drawCards[dc]);

    /* 竖向卡列：滚动到两端时把滚动交还页面，避免"卡住滚不动" */
    document.querySelectorAll('.draw__rail').forEach(function (rail) {
      rail.addEventListener('wheel', function (e) {
        var max = rail.scrollHeight - rail.clientHeight;
        if (max <= 1) return;                  // 卡没溢出，正常滚页面
        var delta = e.deltaY;
        var next = rail.scrollTop + delta;
        var atTop = rail.scrollTop <= 0 && delta < 0;
        var atBottom = rail.scrollTop >= max - 0.5 && delta > 0;
        if (atTop || atBottom) return;         // 到顶/到底 → 交还页面
        e.preventDefault();
        rail.scrollTop = next;
      }, { passive: false });
    });
  }

  /* ------------------------------------------------------------
     10. 平滑锚点（兼容不支持 scroll-behavior 的浏览器）
     ------------------------------------------------------------ */
  if (!('scrollBehavior' in docEl.style)) {
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var id = link.getAttribute('href');
        if (!id || id === '#' || id.length < 2) return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        window.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
      });
    });
  }

  /* ------------------------------------------------------------
     11. 页面隐藏时暂停首屏背景视频，省电
     ------------------------------------------------------------ */
  document.addEventListener('visibilitychange', function () {
    if (!video || !media) return;
    if (document.hidden) {
      video.pause();
    } else if (!media.classList.contains('is-fallback')) {
      var p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
  });

  /* ------------------------------------------------------------
     12. 卡片：鼠标跟随的 3D 倾斜 + 微放大
     —— 第五屏项目作品 + 第六屏荣誉证书共用同一套机制
     —— 用 CSS 变量驱动 transform，JS 只负责算角度
     ------------------------------------------------------------ */
  (function initTilt() {
    if (typeof window.matchMedia !== 'function') return;

    // 只在「有精确指针 + 未开启减弱动效」时启用
    var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduced) return;

    var cards = Array.prototype.slice.call(
      document.querySelectorAll('.proj-card, .honor-card')
    );
    if (!cards.length) return;

    var MAX = 5;   // 单侧最大倾角（度）——「微微」一点就够

    cards.forEach(function (card) {
      var queued = false;
      var lastEvt = null;

      function apply() {
        queued = false;
        if (!lastEvt) return;

        var r = card.getBoundingClientRect();
        if (!r.width || !r.height) return;

        // 归一化指针位置：左上 (0,0) → 右下 (1,1)
        var px = (lastEvt.clientX - r.left) / r.width;
        var py = (lastEvt.clientY - r.top) / r.height;
        px = px < 0 ? 0 : (px > 1 ? 1 : px);
        py = py < 0 ? 0 : (py > 1 ? 1 : py);

        // 指针偏右 → 卡片右转（rotateY 为正）；指针偏上 → 卡片上仰
        card.style.setProperty('--ry', ((px - 0.5) * 2 * MAX).toFixed(2) + 'deg');
        card.style.setProperty('--rx', ((0.5 - py) * 2 * MAX).toFixed(2) + 'deg');

        // 跟随指针的高光位置
        card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      }

      card.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        // 真正开始移动后才切换成「跟手」的短过渡，
        // 这样刚悬停上来时的抬升仍然是柔和的长缓动
        if (!card.classList.contains('is-tilting')) card.classList.add('is-tilting');
        lastEvt = e;
        if (queued) return;
        queued = true;
        requestAnimationFrame(apply);
      });

      function reset() {
        lastEvt = null;
        card.classList.remove('is-tilting');
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
        card.style.removeProperty('--mx');
        card.style.removeProperty('--my');
      }

      card.addEventListener('pointerleave', reset);
      card.addEventListener('pointercancel', reset);
      // 键盘聚焦 / 点击后也回到平面，避免残留倾斜
      card.addEventListener('blur', reset);
    });
  })();

  /* ------------------------------------------------------------
     13. 荣誉证书：真实图片可用时，覆盖纯 CSS 占位证书
     —— assets/certs/honor-01.jpg ~ honor-10.jpg 放进去就自动生效
     ------------------------------------------------------------ */
  (function initHonorImages() {
    var imgs = Array.prototype.slice.call(document.querySelectorAll('.honor-card__img'));
    if (!imgs.length) return;

    imgs.forEach(function (img) {
      var card = img.closest ? img.closest('.honor-card') : null;
      if (!card) return;

      function ok() {
        card.classList.add('is-loaded');
        img.hidden = false;
      }
      function fail() {
        card.classList.remove('is-loaded');
        img.hidden = true;   // 退回 CSS 占位证书，不留破图
      }

      // 已在缓存里的图片不会再触发 load，需要主动判断一次
      if (img.complete) {
        if (img.naturalWidth > 0) ok(); else fail();
        return;
      }
      img.addEventListener('load', ok);
      img.addEventListener('error', fail);
    });
  })();

  /* ------------------------------------------------------------
     14. 联系我：一键复制 + 轻提示
     —— 优先用 Clipboard API（https / localhost），
        本地 file:// 打开时自动回退到 execCommand
     ------------------------------------------------------------ */
  (function initContactCopy() {
    var toast = document.getElementById('toast');
    var toastText = document.getElementById('toastText');
    var buttons = Array.prototype.slice.call(
      document.querySelectorAll('.contact-card__copy')
    );
    if (!buttons.length) return;

    var toastTimer = null;

    function showToast(msg) {
      if (!toast) return;
      if (toastText && msg) toastText.textContent = msg;
      toast.classList.add('is-show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toast.classList.remove('is-show');
      }, 2000);
    }

    // 老浏览器 / 非安全上下文兜底
    function legacyCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.left = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).then(function () {
          return true;
        }).catch(function () {
          return legacyCopy(text);
        });
      }
      return Promise.resolve(legacyCopy(text));
    }

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy') || '';
        if (!text) return;

        copyText(text).then(function (ok) {
          if (!ok) {
            showToast('复制失败，请手动选择复制');
            return;
          }
          btn.classList.add('is-copied');
          setTimeout(function () { btn.classList.remove('is-copied'); }, 1800);
          showToast('已复制：' + text);
        });
      });
    });
  })();

  /* ------------------------------------------------------------
     15. 环境层 · 纸飞机飞行的七个环境
     —— 滚动时按「当前焦点落在哪两个屏之间」算交叉淡入权重，
        并给每层按 data-depth 做视差，形成持续向前的飞行感
     —— 跨越屏边界时在 #envFx 上播一次穿越粒子特效
     —— 尾流配色与强度通过 ENVSTATE 交给光标模块消费
     ------------------------------------------------------------ */
  (function initEnvironments() {
    var envEl = document.getElementById('env');
    if (!envEl) return;

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* 七个环境：顺序即飞行顺序 */
    var SCENES = [
      { key: 'sky',     section: 'home',    name: '云海起飞',  trail: [255, 255, 255], burst: 'mist'  },
      { key: 'cloud',   section: 'about',   name: '穿越云层',  trail: [246, 250, 255], burst: 'mist'  },
      { key: 'forest',  section: 'work',    name: '森林上方',  trail: [216, 242, 194], burst: 'leaf'  },
      { key: 'grove',   section: 'exp',     name: '林间低飞',  trail: [198, 234, 172], burst: 'shaft' },
      { key: 'city',    section: 'proj',    name: '城市夜航',  trail: [172, 210, 255], burst: 'trail' },
      { key: 'hall',    section: 'honor',   name: '金色展厅',  trail: [255, 224, 154], burst: 'dust'  },
      { key: 'space',   section: 'contact', name: '落定星空',  trail: [216, 198, 255], burst: 'star'  }
    ];

    var sceneEls = [];
    var sectionEls = [];
    var layerGroups = [];
    var ok = true;

    SCENES.forEach(function (cfg) {
      var sec = document.getElementById(cfg.section);
      var el = envEl.querySelector('[data-scene="' + cfg.key + '"]');
      if (!sec || !el) { ok = false; return; }
      sectionEls.push(sec);
      sceneEls.push(el);
      layerGroups.push(
        Array.prototype.slice.call(el.querySelectorAll('.env__l')).map(function (l) {
          return {
            el: l,
            depth: parseFloat(l.getAttribute('data-depth')) || 0.08,
            lastY: 99999
          };
        })
      );
    });

    if (!ok || !sectionEls.length) return;

    // 环境生效：样式由此切换（脚本没跑到这里时，站点维持原深色版）
    docEl.classList.add('has-env');
    ENVSTATE.ready = true;

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /* ---------- 尺寸测量 ---------- */
    var centers = [];
    var maxShift = 0;
    var docH = 0;

    function measure() {
      centers = sectionEls.map(function (s) {
        return s.offsetTop + s.offsetHeight / 2;
      });
      maxShift = window.innerHeight * 0.12;
      docH = docEl.scrollHeight - window.innerHeight;
    }

    /* ---------- 每帧：交叉淡入 + 视差 + 尾流配色 ---------- */
    var curIdx = -1;
    var rgbNow = [255, 255, 255];

    function updateScreens() {
      if (!centers.length) return;

      var focus = window.scrollY + window.innerHeight / 2;

      // 焦点落在第 i 与第 i+1 屏之间
      var i = 0;
      while (i < centers.length - 2 && focus > centers[i + 1]) i++;

      var span = centers[i + 1] - centers[i];
      var t = span > 0 ? clamp((focus - centers[i]) / span, 0, 1) : 0;

      for (var k = 0; k < sceneEls.length; k++) {
        // 只有相邻两屏参与淡入淡出，其余强制归零
        var o = k === i ? (1 - t) : (k === i + 1 ? t : 0);
        var on = o >= 0.002;
        sceneEls[k].style.opacity = on ? o.toFixed(3) : '0';
        // 关掉的场景直接退出绘制。手机上七个全屏场景同时参与光栅化会把
        // 显存吃光，滑动时就是白屏闪烁（详见 style.css 末尾同名注释）。
        sceneEls[k].style.visibility = on ? 'visible' : 'hidden';
      }

      // 视差：以本屏中心为原点，越远的层走得越慢
      if (!reduced) {
        applyParallax(i, focus - centers[i]);
        applyParallax(i + 1, focus - centers[i + 1]);
      }

      // 尾流配色在两屏之间插值
      var a = SCENES[i].trail, b = SCENES[i + 1].trail;
      rgbNow = [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t)
      ];
      ENVSTATE.rgb = rgbNow;

      // 进入新环境 → 播一次穿越
      var active = t < 0.5 ? i : i + 1;
      if (active !== curIdx) {
        if (curIdx !== -1) triggerBurst(SCENES[active].burst, SCENES[active].key);
        curIdx = active;
      }
    }

    function applyParallax(idx, delta) {
      var group = layerGroups[idx];
      if (!group) return;
      for (var k = 0; k < group.length; k++) {
        var l = group[k];
        var y = clamp(delta * l.depth, -maxShift, maxShift);
        // 变化很小时不写样式，省掉无谓的重绘
        if (Math.abs(y - l.lastY) < 0.4) continue;
        l.lastY = y;
        l.el.style.transform = 'translate3d(0,' + y.toFixed(1) + 'px,0)';
      }
    }

    /* ---------- 调度 ---------- */
    var envDirty = false;
    var envRaf = null;

    function scheduleEnv() {
      envDirty = true;
      if (envRaf === null) envRaf = requestAnimationFrame(function () {
        envRaf = null;
        if (envDirty) { envDirty = false; updateScreens(); }
      });
    }

    window.addEventListener('scroll', scheduleEnv, { passive: true });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        setupFxCanvas();
        measure();
        scheduleEnv();
      }, 150);
    });

    /* ============================================================
       穿越特效：一套粒子系统，按环境切换形态
       ============================================================ */
    var fxCanvas = document.getElementById('envFx');
    var FXC = null, FXW = 0, FXH = 0, FXDPR = 1;
    var parts = [], pool = [];
    var fxActive = false, fxStart = 0, fxRaf = null;
    var FX_DUR = 1150;   // ms
    var kindNow = 'mist';
    var sprites = {};

    function setupFxCanvas() {
      if (!fxCanvas || reduced) return;
      FXDPR = Math.min(window.devicePixelRatio || 1, 2);
      FXW = window.innerWidth;
      FXH = window.innerHeight;
      fxCanvas.width = Math.floor(FXW * FXDPR);
      fxCanvas.height = Math.floor(FXH * FXDPR);
      FXC = fxCanvas.getContext('2d');
      if (FXC) FXC.setTransform(FXDPR, 0, 0, FXDPR, 0, 0);
    }

    /* 预渲染柔光圆点，避免每帧 createRadialGradient */
    function sprite(rgb) {
      var key = rgb.join(',');
      if (sprites[key]) return sprites[key];
      var size = 128;
      var cv = document.createElement('canvas');
      cv.width = cv.height = size;
      var c2 = cv.getContext('2d');
      var g = c2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(' + key + ', 1)');
      g.addColorStop(0.4, 'rgba(' + key + ', .34)');
      g.addColorStop(1, 'rgba(' + key + ', 0)');
      c2.fillStyle = g;
      c2.fillRect(0, 0, size, size);
      sprites[key] = cv;
      return cv;
    }

    function take() { return pool.length ? pool.pop() : {}; }

    function rand(a, b) { return a + Math.random() * (b - a); }

    /* 按环境装配粒子 */
    function emit(kind) {
      var i, p, n, cx, cy, ang, sp;

      if (kind === 'mist') {
        // 入云层：白色雾团从画面中心朝四周高速掠过
        n = 30;
        cx = FXW / 2; cy = FXH * 0.52;
        for (i = 0; i < n; i++) {
          p = take();
          ang = Math.random() * Math.PI * 2;
          sp = rand(900, 2100);
          p.x = cx + Math.cos(ang) * rand(40, FXH * 0.28);
          p.y = cy + Math.sin(ang) * rand(40, FXH * 0.28);
          p.vx = Math.cos(ang) * sp;
          p.vy = Math.sin(ang) * sp;
          p.r = rand(90, 300);
          p.grow = rand(120, 320);
          p.a = rand(.16, .42);
          p.rgb = [255, 255, 255];
          parts.push(p);
        }
      } else if (kind === 'leaf') {
        // 入森林：深绿叶片斜掠而过
        n = 52;
        for (i = 0; i < n; i++) {
          p = take();
          p.x = rand(-FXW * 0.2, FXW * 1.1);
          p.y = rand(-FXH * 0.25, FXH * 0.6);
          p.vx = rand(320, 900);
          p.vy = rand(280, 780);
          p.r = rand(4, 11);
          p.rot = Math.random() * Math.PI;
          p.vr = rand(-6, 6);
          p.a = rand(.42, .9);
          p.rgb = Math.random() < 0.5 ? [46, 92, 58] : [88, 138, 74];
          parts.push(p);
        }
      } else if (kind === 'shaft') {
        // 入林间：阳光光斑与光束横向掠过
        n = 26;
        for (i = 0; i < n; i++) {
          p = take();
          p.x = rand(-FXW * 0.15, FXW * 0.9);
          p.y = rand(0, FXH);
          p.vx = rand(1400, 2600);
          p.vy = rand(-90, 90);
          p.r = rand(150, 460);
          p.th = rand(2, 6);
          p.a = rand(.16, .4);
          p.rgb = [255, 248, 216];
          parts.push(p);
        }
      } else if (kind === 'trail') {
        // 入城市：霓虹灯轨拉丝
        n = 34;
        for (i = 0; i < n; i++) {
          p = take();
          p.x = rand(-FXW * 0.2, FXW * 1.05);
          p.y = rand(FXH * 0.1, FXH * 1.05);
          p.vx = rand(1500, 3000);
          p.vy = rand(-140, 140);
          p.r = rand(200, 720);
          p.th = rand(1.4, 3.6);
          p.a = rand(.24, .6);
          p.rgb = Math.random() < 0.5 ? [160, 214, 255] : [226, 178, 255];
          parts.push(p);
        }
      } else if (kind === 'dust') {
        // 入展厅：暖金尘埃上浮
        n = 58;
        for (i = 0; i < n; i++) {
          p = take();
          p.x = rand(0, FXW);
          p.y = rand(FXH * 0.35, FXH * 1.08);
          p.vx = rand(-60, 60);
          p.vy = rand(-220, -70);
          p.r = rand(3, 13);
          p.grow = rand(-4, 6);
          p.a = rand(.25, .7);
          p.rgb = Math.random() < 0.6 ? [255, 226, 158] : [255, 246, 218];
          parts.push(p);
        }
      } else {
        // 入星空：星屑向中心汇聚
        n = 56;
        cx = FXW / 2; cy = FXH * 0.5;
        for (i = 0; i < n; i++) {
          p = take();
          ang = Math.random() * Math.PI * 2;
          var dist = rand(FXH * 0.45, FXH * 0.95);
          p.x = cx + Math.cos(ang) * dist;
          p.y = cy + Math.sin(ang) * dist;
          p.vx = -Math.cos(ang) * rand(260, 640);
          p.vy = -Math.sin(ang) * rand(260, 640);
          p.r = rand(2, 6);
          p.grow = rand(4, 16);
          p.a = rand(.5, 1);
          p.rgb = Math.random() < 0.5 ? [255, 255, 255] : [206, 214, 255];
          parts.push(p);
        }
      }
    }

    function stepFx(now) {
      fxRaf = null;
      if (!FXC) { fxActive = false; return; }

      var p = clamp((now - fxStart) / FX_DUR, 0, 1);

      // 前 22% 迅速铺开，后段整体淡出
      var fade = p < 0.22 ? (p / 0.22) : (1 - (p - 0.22) / 0.78);
      fade = clamp(fade, 0, 1);

      FXC.clearRect(0, 0, FXW, FXH);

      var additive = (kindNow !== 'leaf');
      FXC.globalCompositeOperation = additive ? 'lighter' : 'source-over';

      var dt = 1 / 60;
      for (var i = 0; i < parts.length; i++) {
        var q = parts[i];
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.grow) {
          q.r = Math.max(1, q.r + q.grow * dt);
          q.grow *= 0.985;
        }
        if (q.vr) q.rot += q.vr * dt;

        var alpha = q.a * fade;
        if (alpha <= 0.004) continue;

        if (kindNow === 'leaf') {
          FXC.save();
          FXC.translate(q.x, q.y);
          FXC.rotate(q.rot);
          FXC.globalAlpha = alpha;
          FXC.fillStyle = 'rgb(' + q.rgb.join(',') + ')';
          FXC.beginPath();
          FXC.ellipse(0, 0, q.r, q.r * 0.42, 0, 0, Math.PI * 2);
          FXC.fill();
          FXC.restore();
        } else if (kindNow === 'shaft' || kindNow === 'trail') {
          FXC.globalAlpha = alpha;
          var grad = FXC.createLinearGradient(q.x, q.y, q.x + q.r, q.y);
          var c = q.rgb.join(',');
          grad.addColorStop(0, 'rgba(' + c + ', 0)');
          grad.addColorStop(0.5, 'rgba(' + c + ', 1)');
          grad.addColorStop(1, 'rgba(' + c + ', 0)');
          FXC.fillStyle = grad;
          FXC.fillRect(q.x, q.y - q.th / 2, q.r, q.th);
        } else {
          // mist / dust / star 用预渲染的柔光圆点
          var sp = sprite(q.rgb);
          FXC.globalAlpha = alpha;
          FXC.drawImage(sp, q.x - q.r, q.y - q.r, q.r * 2, q.r * 2);
        }
      }

      FXC.globalAlpha = 1;
      FXC.globalCompositeOperation = 'source-over';

      // 穿越瞬间尾流提速、变亮
      ENVSTATE.gain = 1 + Math.sin(p * Math.PI) * 0.62;
      ENVSTATE.burst = 1 - p;

      if (p < 1) {
        fxRaf = requestAnimationFrame(stepFx);
      } else {
        fxActive = false;
        ENVSTATE.gain = 1;
        ENVSTATE.burst = 0;
        // 粒子回收进池，下一次穿越复用，不再新建对象
        for (var m = 0; m < parts.length; m++) pool.push(parts[m]);
        parts.length = 0;
        FXC.clearRect(0, 0, FXW, FXH);
        if (fxCanvas) fxCanvas.classList.remove('is-on');
      }
    }

    function triggerBurst(kind, key) {
      if (reduced || !fxCanvas || !FXC) return;
      kindNow = kind;
      if (parts.length) {
        for (var r = 0; r < parts.length; r++) pool.push(parts[r]);
        parts.length = 0;
      }
      emit(kind);
      fxActive = true;
      fxStart = performance.now();
      fxCanvas.classList.add('is-on');
      if (fxRaf === null) fxRaf = requestAnimationFrame(stepFx);
      ENVSTATE.gain = 1.35;
    }

    /* 自检钩子：只有带 ?envdebug 时才挂到 window 上。
       无头浏览器里 rAF 基本不跑、window.scrollTo 也不生效，
       留这个口子就能离线核对"滚动分屏"与"穿越特效"到底对不对。 */
    if (/[?&]envdebug/.test(location.search)) {
      window.__envDebug = {
        update: updateScreens,
        measure: measure,
        burst: triggerBurst,
        /* 把一次穿越推进到 30% 处画一帧，便于截图 */
        frame: function (at) {
          var t = at || performance.now();
          fxStart = t - FX_DUR * 0.3;
          fxActive = true;
          if (fxCanvas) fxCanvas.classList.add('is-on');
          stepFx(t);
        },
        state: ENVSTATE,
        centers: function () { return centers; }
      };
    }

    /* ---------- 启动 ---------- */
    measure();
    setupFxCanvas();
    updateScreens();

    // 字体与图片加载完会改变分屏高度，重新量一次
    window.addEventListener('load', function () { measure(); scheduleEnv(); });
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { measure(); scheduleEnv(); });
    }
    setTimeout(function () { measure(); scheduleEnv(); }, 600);
  })();

})();
