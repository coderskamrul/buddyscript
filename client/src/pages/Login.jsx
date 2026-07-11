import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthShapes, { FieldError, FormError } from '../components/auth/AuthShapes';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    // Clear the error as soon as the user starts fixing the field — leaving it
    // up while they type reads as the app not noticing.
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
  };

  const validate = () => {
    const next = {};
    if (!form.email.trim()) next.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Enter a valid email address.';
    if (!form.password) next.password = 'Password is required.';
    return next;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const found = validate();
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    setSubmitting(true);
    try {
      await login({ email: form.email.trim(), password: form.password });
      // Send them back to whatever they were trying to reach before the guard
      // bounced them here.
      const destination = location.state?.from?.pathname || '/feed';
      navigate(destination, { replace: true });
    } catch (error) {
      setFormError(error.message);
      if (error.fieldErrors) setErrors(error.fieldErrors);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="_social_login_wrapper _layout_main_wrapper">
      <AuthShapes />

      <div className="_social_login_wrap">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-xl-8 col-lg-8 col-md-12 col-sm-12">
              <div className="_social_login_left">
                <div className="_social_login_left_image">
                  <img src="/assets/images/login.png" alt="" className="_left_img" />
                </div>
              </div>
            </div>

            <div className="col-xl-4 col-lg-4 col-md-12 col-sm-12">
              <div className="_social_login_content">
                <div className="_social_login_left_logo _mar_b28">
                  <img src="/assets/images/logo.svg" alt="Buddy Script" className="_left_logo" />
                </div>

                <p className="_social_login_content_para _mar_b8">Welcome back</p>
                <h4 className="_social_login_content_title _titl4 _mar_b50">Login to your account</h4>

                {/* Kept from the supplied design, but disabled: social sign-in is
                    explicitly out of scope, and a button that silently does
                    nothing is worse than one that says so. */}
                <button
                  type="button"
                  className="_social_login_content_btn _mar_b40"
                  disabled
                  title="Social sign-in is not part of this build — use email and password below."
                  style={{ opacity: 0.55, cursor: 'not-allowed' }}
                >
                  <img src="/assets/images/google.svg" alt="" className="_google_img" />{' '}
                  <span>Or sign-in with google</span>
                </button>

                <div className="_social_login_content_bottom_txt _mar_b40">
                  <span>Or</span>
                </div>

                <form className="_social_login_form" onSubmit={submit} noValidate>
                  <FormError>{formError}</FormError>

                  <div className="row">
                    <div className="col-xl-12 col-lg-12 col-md-12 col-sm-12">
                      <div className="_social_login_form_input _mar_b14">
                        <label className="_social_login_label _mar_b8" htmlFor="login-email">
                          Email
                        </label>
                        <input
                          id="login-email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          className="form-control _social_login_input"
                          value={form.email}
                          onChange={update('email')}
                          aria-invalid={Boolean(errors.email)}
                          aria-describedby={errors.email ? 'login-email-error' : undefined}
                        />
                        <span id="login-email-error">
                          <FieldError>{errors.email}</FieldError>
                        </span>
                      </div>
                    </div>

                    <div className="col-xl-12 col-lg-12 col-md-12 col-sm-12">
                      <div className="_social_login_form_input _mar_b14">
                        <label className="_social_login_label _mar_b8" htmlFor="login-password">
                          Password
                        </label>
                        <input
                          id="login-password"
                          name="password"
                          type="password"
                          autoComplete="current-password"
                          className="form-control _social_login_input"
                          value={form.password}
                          onChange={update('password')}
                          aria-invalid={Boolean(errors.password)}
                          aria-describedby={errors.password ? 'login-password-error' : undefined}
                        />
                        <span id="login-password-error">
                          <FieldError>{errors.password}</FieldError>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="row">
                    <div className="col-lg-6 col-xl-6 col-md-6 col-sm-12">
                      <div className="form-check _social_login_form_check">
                        <input
                          className="form-check-input _social_login_form_check_input"
                          type="checkbox"
                          id="login-remember"
                          defaultChecked
                          disabled
                          title="Sessions already persist for 30 days via a secure refresh token."
                        />
                        <label
                          className="form-check-label _social_login_form_check_label"
                          htmlFor="login-remember"
                        >
                          Remember me
                        </label>
                      </div>
                    </div>
                    <div className="col-lg-6 col-xl-6 col-md-6 col-sm-12">
                      <div className="_social_login_form_left">
                        {/* Out of scope per the brief; kept for design fidelity. */}
                        <p
                          className="_social_login_form_left_para"
                          title="Password recovery is not part of this build."
                          style={{ opacity: 0.55, cursor: 'not-allowed' }}
                        >
                          Forgot password?
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="row">
                    <div className="col-lg-12 col-md-12 col-xl-12 col-sm-12">
                      <div className="_social_login_form_btn _mar_t40 _mar_b60">
                        <button
                          type="submit"
                          className="_social_login_form_btn_link _btn1"
                          disabled={submitting}
                        >
                          {submitting ? 'Signing in…' : 'Login now'}
                        </button>
                      </div>
                    </div>
                  </div>
                </form>

                <div className="row">
                  <div className="col-xl-12 col-lg-12 col-md-12 col-sm-12">
                    <div className="_social_login_bottom_txt">
                      <p className="_social_login_bottom_txt_para">
                        Dont have an account? <Link to="/register">Create New Account</Link>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
