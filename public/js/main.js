document.addEventListener('DOMContentLoaded', function() {
    // 신규 모바일 메뉴 오버레이 토글
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const mobileNavOverlay = document.querySelector('.mobile-nav-overlay');
    const mobileNavClose = document.querySelector('.mobile-nav-close');
    const mobileNavLinks = document.querySelectorAll('.mobile-nav a');

    if (mobileMenuBtn && mobileNavOverlay && mobileNavClose) {
        // 메뉴 열기
        mobileMenuBtn.addEventListener('click', () => {
            mobileNavOverlay.classList.add('active');
        });

        // 닫기 버튼으로 메뉴 닫기
        mobileNavClose.addEventListener('click', () => {
            mobileNavOverlay.classList.remove('active');
        });

        // 메뉴 링크 클릭 시 메뉴 닫기
        mobileNavLinks.forEach(link => {
            link.addEventListener('click', () => {
                mobileNavOverlay.classList.remove('active');
            });
        });
    }

    // 매물 상세 페이지 썸네일 클릭 이벤트
    const mainImage = document.getElementById('main-property-image');
    const thumbnails = document.querySelectorAll('.thumbnail');

    if (mainImage && thumbnails.length > 0) {
        thumbnails.forEach(thumbnail => {
            thumbnail.addEventListener('click', function() {
                // 모든 썸네일에서 active 클래스 제거
                thumbnails.forEach(t => t.classList.remove('active'));
                // 클릭된 썸네일에 active 클래스 추가
                this.classList.add('active');
                // 메인 이미지 소스를 클릭된 썸네일의 소스로 변경
                mainImage.src = this.src;
            });
        });

        // 페이지 로드 시 첫 번째 썸네일에 active 클래스 추가
        if (thumbnails.length > 0) {
            thumbnails[0].classList.add('active');
        }
    }

    // 퀵메뉴 즉시 표시
    const quickMenu = document.querySelector('.quick-menu');
    if (quickMenu) {
        quickMenu.classList.add('visible');
    }

    // 모바일 보기 버튼 이벤트
    const mobileViewBtn = document.getElementById('mobile-view-btn');
    if (mobileViewBtn) {
        mobileViewBtn.addEventListener('click', function(e) {
            e.preventDefault();
            const width = 414; // iPhone XR width
            const height = 896; // iPhone XR height
            const left = (screen.width / 2) - (width / 2);
            const top = (screen.height / 2) - (height / 2);
            window.open(window.location.href, 'mobileWindow', `width=${width},height=${height},top=${top},left=${left}`);
        });
    }
});
