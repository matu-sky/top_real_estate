document.addEventListener('DOMContentLoaded', function() {
    // 모바일 메뉴 토글
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const nav = document.querySelector('nav');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            nav.classList.toggle('active');
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
});
