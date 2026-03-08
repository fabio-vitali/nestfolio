import { TestBed, ComponentFixture } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MfeErrorComponent } from './mfe-error.component';

describe('MfeErrorComponent', () => {
  let fixture: ComponentFixture<MfeErrorComponent>;
  let component: MfeErrorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(MfeErrorComponent, {
        set: {
          imports: [CommonModule],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(MfeErrorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and display error content', () => {
    expect(component).toBeTruthy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Module Load Error');
  });
});
