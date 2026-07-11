import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthShapes, { FieldError, FormError } from '../components/auth/AuthShapes';

const EMPTY = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
};

/** Mirrors the server's rule exactly, so the client never accepts what the API
 *  will reject. */
const passwordProblem = (password) => {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-zA-Z]/.test(password)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  return null;
};

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
  };

  const validate = () => {
    const next = {};

    if (!form.firstName.trim()) next.firstName = 'First name is required.';
    if (!form.lastName.trim()) next.lastName = 'Last name is required.';

    if (!form.email.trim()) next.email = 'Email is required.';
    else if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Enter a valid email address.';

    const problem = passwordProblem(form.password);
    if (problem) next.password = problem;

    if (form.confirmPassword !== form.password) next.confirmPassword = 'Passwords do not match.';

    if (!acceptTerms) next.acceptTerms = 'You must accept the terms & conditions.';

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
      await register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
        confirmPassword: form.confirmPassword,
        acceptTerms,
      });
      // Registration signs you straight in — bouncing a brand-new user to a
      // login form to retype what they just typed is pointless friction.
      navigate('/feed', { replace: true });
    } catch (error) {
      setFormError(error.message);
      if (error.fieldErrors) setErrors(error.fieldErrors);
    } finally {
      setSubmitting(false);
    }
  };

  const field = (name, label, type = 'text', autoComplete = undefined) => (
    <div className="col-xl-12 col-lg-12 col-md-12 col-sm-12">
      <div className="_social_registration_form_input _mar_b14">
        <label className="_social_registration_label _mar_b8" htmlFor={`reg-${name}`}>
          {label}
        </label>
        <input
          id={`reg-${name}`}
          name={name}
          type={type}
          autoComplete={autoComplete}
          className="form-control _social_registration_input"
          value={form[name]}
          onChange={update(name)}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={errors[name] ? `reg-${name}-error` : undefined}
        />
        <span id={`reg-${name}-error`}>
          <FieldError>{errors[name]}</FieldError>
        </span>
      </div>
    </div>
  );

  return (
    <section className="_social_registration_wrapper _layout_main_wrapper">
      <AuthShapes />

      <div className="_social_registration_wrap">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-xl-8 col-lg-8 col-md-12 col-sm-12">
              <div className="_social_registration_right">
                <div className="_social_registration_right_image">
                  <img src="/assets/images/registration.png" alt="" />
                </div>
                <div className="_social_registration_right_image_dark">
                  <img src="/assets/images/registration1.png" alt="" />
                </div>
              </div>
            </div>

            <div className="col-xl-4 col-lg-4 col-md-12 col-sm-12">
              <div className="_social_registration_content">
                <div className="_social_registration_right_logo _mar_b28">
                  <img src="/assets/images/logo.svg" alt="Buddy Script" className="_right_logo" />
                </div>

                <p className="_social_registration_content_para _mar_b8">Get Started Now</p>
                <h4 className="_social_registration_content_title _titl4 _mar_b50">Registration</h4>

                {/* Kept from the design, disabled: social sign-up is out of scope. */}
                <button
                  type="button"
                  className="_social_registration_content_btn _mar_b40"
                  disabled
                  title="Social sign-up is not part of this build — use the form below."
                  style={{ opacity: 0.55, cursor: 'not-allowed' }}
                >
                  <img src="/assets/images/google.svg" alt="" className="_google_img" />{' '}
                  <span>Register with google</span>
                </button>

                <div className="_social_registration_content_bottom_txt _mar_b40">
                  <span>Or</span>
                </div>

                <form className="_social_registration_form" onSubmit={submit} noValidate>
                  <FormError>{formError}</FormError>

                  <div className="row">
                    {/* First and last name are required by the brief but absent
                        from the supplied markup, so they are added here using the
                        design's own input classes. */}
                    {field('firstName', 'First Name', 'text', 'given-name')}
                    {field('lastName', 'Last Name', 'text', 'family-name')}
                    {field('email', 'Email', 'email', 'email')}
                    {field('password', 'Password', 'password', 'new-password')}
                    {field('confirmPassword', 'Repeat Password', 'password', 'new-password')}
                  </div>

                  <div className="row">
                    <div className="col-lg-12 col-xl-12 col-md-12 col-sm-12">
                      <div className="form-check _social_registration_form_check">
                        <input
                          className="form-check-input _social_registration_form_check_input"
                          type="checkbox"
                          id="reg-terms"
                          checked={acceptTerms}
                          onChange={(event) => {
                            setAcceptTerms(event.target.checked);
                            setErrors((current) => ({ ...current, acceptTerms: undefined }));
                          }}
                          aria-invalid={Boolean(errors.acceptTerms)}
                        />
                        <label
                          className="form-check-label _social_registration_form_check_label"
                          htmlFor="reg-terms"
                        >
                          I agree to terms &amp; conditions
                        </label>
                        <FieldError>{errors.acceptTerms}</FieldError>
                      </div>
                    </div>
                  </div>

                  <div className="row">
                    <div className="col-lg-12 col-md-12 col-xl-12 col-sm-12">
                      <div className="_social_registration_form_btn _mar_t40 _mar_b60">
                        <button
                          type="submit"
                          className="_social_registration_form_btn_link _btn1"
                          disabled={submitting}
                        >
                          {submitting ? 'Creating account…' : 'Register now'}
                        </button>
                      </div>
                    </div>
                  </div>
                </form>

                <div className="row">
                  <div className="col-xl-12 col-lg-12 col-md-12 col-sm-12">
                    <div className="_social_registration_bottom_txt">
                      {/* The template shipped this as "Dont have an account? /
                          Create New Account" on the *registration* page, which is
                          backwards. Pointed at login instead. */}
                      <p className="_social_registration_bottom_txt_para">
                        Already have an account? <Link to="/login">Login</Link>
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
