/**
 * The stories strip above the composer, reproduced from the supplied design
 * (feed.html, "For Desktop" / "For Mobile" blocks).
 *
 * Static by design: stories are not in the brief's feature list, so this is
 * presentational only — the same placeholder people and images the mockup ships.
 * Both variants are rendered; the design's own CSS shows the grid on desktop and
 * the scrolling strip on mobile.
 */
export default function Stories() {
  return (
    <>
      {/* For Desktop */}
      <div className="_feed_inner_ppl_card _mar_b16">
        <div className="_feed_inner_story_arrow">
          <button type="button" className="_feed_inner_story_arrow_btn" aria-label="Next stories">
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="8" fill="none" viewBox="0 0 9 8" aria-hidden="true">
              <path
                fill="#fff"
                d="M8 4l.366-.341.318.341-.318.341L8 4zm-7 .5a.5.5 0 010-1v1zM5.566.659l2.8 3-.732.682-2.8-3L5.566.66zm2.8 3.682l-2.8 3-.732-.682 2.8-3 .732.682zM8 4.5H1v-1h7v1z"
              />
            </svg>
          </button>
        </div>

        <div className="row">
          <div className="col-xl-3 col-lg-3 col-md-4 col-sm-4 col">
            <div className="_feed_inner_profile_story _b_radious6">
              <div className="_feed_inner_profile_story_image">
                <img src="/assets/images/card_ppl1.png" alt="Image" className="_profile_story_img" />
                <div className="_feed_inner_story_txt">
                  <div className="_feed_inner_story_btn">
                    <button className="_feed_inner_story_btn_link" type="button" aria-label="Add to your story">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 10 10" aria-hidden="true">
                        <path stroke="#fff" strokeLinecap="round" d="M.5 4.884h9M4.884 9.5v-9" />
                      </svg>
                    </button>
                  </div>
                  <p className="_feed_inner_story_para">Your Story</p>
                </div>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-lg-3 col-md-4 col-sm-4 col">
            <div className="_feed_inner_public_story _b_radious6">
              <div className="_feed_inner_public_story_image">
                <img src="/assets/images/card_ppl2.png" alt="Image" className="_public_story_img" />
                <div className="_feed_inner_pulic_story_txt">
                  <p className="_feed_inner_pulic_story_para">Ryan Roslansky</p>
                </div>
                <div className="_feed_inner_public_mini">
                  <img src="/assets/images/mini_pic.png" alt="Image" className="_public_mini_img" />
                </div>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-lg-3 col-md-4 col-sm-4 _custom_mobile_none">
            <div className="_feed_inner_public_story _b_radious6">
              <div className="_feed_inner_public_story_image">
                <img src="/assets/images/card_ppl3.png" alt="Image" className="_public_story_img" />
                <div className="_feed_inner_pulic_story_txt">
                  <p className="_feed_inner_pulic_story_para">Ryan Roslansky</p>
                </div>
                <div className="_feed_inner_public_mini">
                  <img src="/assets/images/mini_pic.png" alt="Image" className="_public_mini_img" />
                </div>
              </div>
            </div>
          </div>

          <div className="col-xl-3 col-lg-3 col-md-4 col-sm-4 _custom_none">
            <div className="_feed_inner_public_story _b_radious6">
              <div className="_feed_inner_public_story_image">
                <img src="/assets/images/card_ppl4.png" alt="Image" className="_public_story_img" />
                <div className="_feed_inner_pulic_story_txt">
                  <p className="_feed_inner_pulic_story_para">Ryan Roslansky</p>
                </div>
                <div className="_feed_inner_public_mini">
                  <img src="/assets/images/mini_pic.png" alt="Image" className="_public_mini_img" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* For Desktop End */}

      {/* For Mobile */}
      <div className="_feed_inner_ppl_card_mobile _mar_b16">
        <div className="_feed_inner_ppl_card_area">
          <ul className="_feed_inner_ppl_card_area_list">
            <li className="_feed_inner_ppl_card_area_item">
              <a href="#0" className="_feed_inner_ppl_card_area_link">
                <div className="_feed_inner_ppl_card_area_story">
                  <img src="/assets/images/mobile_story_img.png" alt="Image" className="_card_story_img" />
                  <div className="_feed_inner_ppl_btn">
                    <span className="_feed_inner_ppl_btn_link">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 12 12" aria-hidden="true">
                        <path stroke="#fff" strokeLinecap="round" strokeLinejoin="round" d="M6 2.5v7M2.5 6h7" />
                      </svg>
                    </span>
                  </div>
                </div>
                <p className="_feed_inner_ppl_card_area_link_txt">Your Story</p>
              </a>
            </li>

            {/* The template nests a second <a> inside the <a> on some of these
                items — invalid HTML that React rejects. Flattened to one anchor;
                the rendering is identical. */}
            <li className="_feed_inner_ppl_card_area_item">
              <a href="#0" className="_feed_inner_ppl_card_area_link">
                <div className="_feed_inner_ppl_card_area_story_active">
                  <img src="/assets/images/mobile_story_img1.png" alt="Image" className="_card_story_img1" />
                </div>
                <p className="_feed_inner_ppl_card_area_txt">Ryan...</p>
              </a>
            </li>
            <li className="_feed_inner_ppl_card_area_item">
              <a href="#0" className="_feed_inner_ppl_card_area_link">
                <div className="_feed_inner_ppl_card_area_story_inactive">
                  <img src="/assets/images/mobile_story_img2.png" alt="Image" className="_card_story_img1" />
                </div>
                <p className="_feed_inner_ppl_card_area_txt">Ryan...</p>
              </a>
            </li>
            <li className="_feed_inner_ppl_card_area_item">
              <a href="#0" className="_feed_inner_ppl_card_area_link">
                <div className="_feed_inner_ppl_card_area_story_active">
                  <img src="/assets/images/mobile_story_img1.png" alt="Image" className="_card_story_img1" />
                </div>
                <p className="_feed_inner_ppl_card_area_txt">Ryan...</p>
              </a>
            </li>
            <li className="_feed_inner_ppl_card_area_item">
              <a href="#0" className="_feed_inner_ppl_card_area_link">
                <div className="_feed_inner_ppl_card_area_story_inactive">
                  <img src="/assets/images/mobile_story_img2.png" alt="Image" className="_card_story_img1" />
                </div>
                <p className="_feed_inner_ppl_card_area_txt">Ryan...</p>
              </a>
            </li>
            <li className="_feed_inner_ppl_card_area_item">
              <a href="#0" className="_feed_inner_ppl_card_area_link">
                <div className="_feed_inner_ppl_card_area_story_active">
                  <img src="/assets/images/mobile_story_img1.png" alt="Image" className="_card_story_img1" />
                </div>
                <p className="_feed_inner_ppl_card_area_txt">Ryan...</p>
              </a>
            </li>
            <li className="_feed_inner_ppl_card_area_item">
              <a href="#0" className="_feed_inner_ppl_card_area_link">
                <div className="_feed_inner_ppl_card_area_story">
                  <img src="/assets/images/mobile_story_img.png" alt="Image" className="_card_story_img" />
                </div>
                <p className="_feed_inner_ppl_card_area_txt">Ryan...</p>
              </a>
            </li>
            <li className="_feed_inner_ppl_card_area_item">
              <a href="#0" className="_feed_inner_ppl_card_area_link">
                <div className="_feed_inner_ppl_card_area_story_active">
                  <img src="/assets/images/mobile_story_img1.png" alt="Image" className="_card_story_img1" />
                </div>
                <p className="_feed_inner_ppl_card_area_txt">Ryan...</p>
              </a>
            </li>
          </ul>
        </div>
      </div>
      {/* For Mobile End */}
    </>
  );
}
